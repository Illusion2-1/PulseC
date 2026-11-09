package server

import (
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/netutil"
)

const challengePrefix = "/.well-known/acme-challenge/"

var dnsLabel = regexp.MustCompile(`(?i)^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
var tokenName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,255}$`)

func (cfg Config) directMode() (bool, error) {
	if cfg.HTTPAddr == "" && cfg.PublicHost == "" && cfg.ACMEWebroot == "" {
		return false, nil
	}
	if cfg.HTTPAddr == "" || cfg.PublicHost == "" || cfg.ACMEWebroot == "" || cfg.CertFile == "" || cfg.KeyFile == "" {
		return false, errors.New("direct mode requires -http-addr, -public-host, -acme-webroot, -cert and -key")
	}
	labels := strings.Split(cfg.PublicHost, ".")
	if len(cfg.PublicHost) > 253 || net.ParseIP(cfg.PublicHost) != nil || strings.Trim(labels[len(labels)-1], "0123456789") == "" {
		return false, errors.New("-public-host must be a DNS hostname")
	}
	for _, label := range labels {
		if !dnsLabel.MatchString(label) {
			return false, errors.New("-public-host must be a DNS hostname")
		}
	}
	return true, nil
}

func challengeHandler(root *os.Root, host string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, challengePrefix) && r.URL.Path != strings.TrimSuffix(challengePrefix, "/") {
			dest := url.URL{Scheme: "https", Host: host, Path: r.URL.Path, RawPath: r.URL.RawPath, RawQuery: r.URL.RawQuery, ForceQuery: r.URL.ForceQuery}
			http.Redirect(w, r, dest.String(), http.StatusPermanentRedirect)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, challengePrefix)
		if r.URL.EscapedPath() != r.URL.Path || !tokenName.MatchString(name) {
			http.NotFound(w, r)
			return
		}
		// Certbot can create and remove the directory while the relay is running.
		// Open it relative to the webroot and resolve the token beneath it.
		dir, err := root.OpenRoot(".well-known/acme-challenge")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer func() { _ = dir.Close() }()
		info, err := dir.Lstat(name)
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		f, err := dir.Open(name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer func() { _ = f.Close() }()
		info, err = f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, name, info.ModTime(), f)
	}
}

// startChallenge serves only HTTP-01 tokens and redirects, including during
// first issuance when the public TLS listeners have no certificate yet.
func startChallenge(cfg Config, result chan<- error, logger *log.Logger) (func(), error) {
	root, err := os.OpenRoot(cfg.ACMEWebroot)
	if err != nil {
		return nil, err
	}
	tcp, err := net.Listen("tcp", cfg.HTTPAddr)
	if err != nil {
		_ = root.Close()
		return nil, err
	}
	ln := netutil.LimitListener(tcp, cfg.MaxSessions)
	srv := &http.Server{Handler: challengeHandler(root, cfg.PublicHost), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	logger.Printf("PulseC HTTP-01 and HTTPS redirects on %s", cfg.HTTPAddr)
	go func() { result <- srv.Serve(ln) }()
	return func() { _ = srv.Close(); _ = ln.Close(); _ = root.Close() }, nil
}
