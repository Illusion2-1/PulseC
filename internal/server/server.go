// Package server serves the embedded site and carries chat commands and events
// over one reliable WebTransport stream per session.
package server

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
	"golang.org/x/net/netutil"

	"pulsec/internal/chat"
)

type Config struct {
	Addr, CertFile, KeyFile string
	MaxSessions, SourceRate int
	StatsInterval           time.Duration
}

// Run serves TCP and UDP on cfg.Addr until shutdown or a listener failure.
func Run(ctx context.Context, cfg Config, static fs.FS, logger *log.Logger, reload <-chan os.Signal) error {
	if cfg.MaxSessions < 1 || cfg.MaxSessions > 4096 || cfg.StatsInterval < 0 || cfg.SourceRate < 1 || cfg.SourceRate > 4096 {
		return errors.New("invalid max-sessions, stats-interval or source-rate")
	}
	cert, pin, err := loadCertificate(cfg)
	if err != nil {
		return err
	}
	local := pin != ""
	// ServeTLS and HTTP/3 clone this config. Both clones consult the same
	// certificate pointer for every full handshake, including clients without SNI.
	var current atomic.Pointer[tls.Certificate]
	current.Store(&cert)
	conf := &tls.Config{
		MinVersion:     tls.VersionTLS13,
		GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) { return current.Load(), nil },
	}
	mux := http.NewServeMux()
	handler := browserHeaders(local, mux)
	wt := &webtransport.Server{H3: &http3.Server{
		Addr: cfg.Addr, TLSConfig: http3.ConfigureTLSConfig(conf.Clone()), Handler: handler,
	}}
	hub := chat.NewHub(cfg.SourceRate)
	gate := newIngress(cfg.MaxSessions)
	gate.configure(wt)
	mux.HandleFunc("/connect", gate.connect(wt, hub, local))
	boot := hub.Started().UTC().Format(time.RFC3339Nano)
	mux.HandleFunc("GET /config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"pin": pin, "boot": boot})
	})
	mux.Handle("/", http.FileServerFS(static))
	srv := &http.Server{
		Handler: handler, TLSConfig: conf, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second,
		IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10,
	}
	tcp, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return err
	}
	ln := netutil.LimitListener(tcp, cfg.MaxSessions)
	defer func() { _ = ln.Close() }()
	defer func() { _ = wt.Close() }()
	defer func() { _ = srv.Close() }()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go maintain(ctx, hub, gate, cfg.StatsInterval, logger)

	result := make(chan error, 2)
	go func() { result <- wt.ListenAndServe() }()
	go func() {
		if local {
			logger.Printf("PulseC http://%s (local certificate valid for 13 days)", cfg.Addr)
			result <- srv.Serve(ln)
		} else {
			logger.Printf("PulseC HTTPS + HTTP/3 on %s", cfg.Addr)
			result <- srv.ServeTLS(ln, "", "")
		}
	}()
	for {
		select {
		case err := <-result:
			return err
		case <-ctx.Done():
			return nil
		case _, open := <-reload:
			if !open {
				reload = nil
				continue
			}
			// The development certificate pin belongs to this process lifetime.
			if local {
				continue
			}
			pair, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
			if err != nil {
				logger.Printf("certificate reload failed: %v", err)
				continue
			}
			current.Store(&pair)
			logger.Print("certificate reloaded")
		}
	}
}
func maintain(ctx context.Context, h *chat.Hub, g *ingress, interval time.Duration, logger *log.Logger) {
	sweep := time.NewTicker(time.Minute)
	defer sweep.Stop()
	var stats <-chan time.Time
	if interval > 0 {
		t := time.NewTicker(interval)
		defer t.Stop()
		stats = t.C
	}
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-sweep.C:
			h.Sweep(now)
		case <-stats:
			stats := h.Stats()
			logger.Printf("stats sessions=%d online=%d rooms=%d admission_denied=%d protocol_failures=%d limited=%d slow_disconnects=%d receipts=%d limit_trips=%d limit_sources=%d", len(g.slots), stats.Online, stats.Rooms, g.denied.Load(), g.failures.Load(), stats.Limited, g.slow.Load(), stats.Receipts, stats.LimitTrips, stats.LimitSources)
		}
	}
}
