package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
	"golang.org/x/net/netutil"

	"pulsec/internal/chat"
)

//go:embed all:web/build
var assets embed.FS

func localCert() (tls.Certificate, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	now := time.Now()
	cert := &x509.Certificate{SerialNumber: big.NewInt(now.UnixNano()), NotBefore: now.Add(-time.Minute), NotAfter: now.Add(13 * 24 * time.Hour), DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	hash := sha256.Sum256(der)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, base64.StdEncoding.EncodeToString(hash[:]), err
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8443", "TCP and UDP listen address")
	certFile := flag.String("cert", "", "HTTPS certificate chain")
	keyFile := flag.String("key", "", "HTTPS private key")
	maxSessions := flag.Int("max-sessions", 1024, "maximum simultaneous WebTransport sessions (1–4096)")
	sourceRate := flag.Int("source-rate", 128, "messages per second per source IP across trips (1–4096; burst is twice the rate)")
	statsInterval := flag.Duration("stats-interval", 0, "print anonymous aggregate counters periodically (0 disables)")
	version := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *version {
		fmt.Println("PulseC 0.1.0-rc.1")
		return
	}
	// Transport libraries may include peer-supplied errors and addresses in their
	// default logs. Log only explicit operator events and anonymous counters.
	logger := log.New(os.Stderr, "", log.LstdFlags)
	log.SetOutput(io.Discard)
	if *maxSessions < 1 || *maxSessions > 4096 || *statsInterval < 0 || *sourceRate < 1 || *sourceRate > 4096 {
		logger.Fatal("invalid max-sessions, stats-interval or source-rate")
	}
	var cert tls.Certificate
	var pin string
	var err error
	local := *certFile == "" && *keyFile == ""
	if local {
		host, _, e := net.SplitHostPort(*addr)
		if e != nil || !loopbackHost(host) {
			logger.Fatal("public listeners require -cert and -key")
		}
		cert, pin, err = localCert()
	} else {
		cert, err = tls.LoadX509KeyPair(*certFile, *keyFile)
	}
	if err != nil {
		logger.Fatal(err)
	}
	conf := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}
	mux := http.NewServeMux()
	wt := &webtransport.Server{H3: &http3.Server{Addr: *addr, TLSConfig: http3.ConfigureTLSConfig(conf.Clone()), Handler: browserHeaders(local, mux)}}
	hub := chat.NewHub(*sourceRate)
	gate := newIngress(*maxSessions)
	gate.configure(wt)
	mux.HandleFunc("/connect", gate.connect(wt, hub, local))
	mux.HandleFunc("GET /config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"pin": pin, "boot": hub.Started().UTC().Format(time.RFC3339Nano)})
	})
	static, err := fs.Sub(assets, "web/build")
	if err != nil {
		logger.Fatal(err)
	}
	mux.Handle("/", http.FileServerFS(static))
	server := &http.Server{Handler: browserHeaders(local, mux), TLSConfig: conf, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		logger.Fatal(err)
	}
	listener = netutil.LimitListener(listener, *maxSessions)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go maintain(ctx, hub, gate, *statsInterval, logger)
	result := make(chan error, 2)
	go func() { result <- wt.ListenAndServe() }()
	go func() {
		if local {
			logger.Printf("PulseC http://%s (local certificate valid for 13 days)", *addr)
			result <- server.Serve(listener)
			return
		}
		logger.Printf("PulseC HTTPS + HTTP/3 on %s", *addr)
		result <- server.ServeTLS(listener, "", "")
	}()
	select {
	case err = <-result:
		logger.Fatal(err)
	case <-ctx.Done():
		_ = server.Close()
		_ = wt.Close()
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
