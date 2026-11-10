package qa

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	wt "github.com/quic-go/webtransport-go"
)

func TestDirectHTTP01Bootstrap(t *testing.T) {
	bin := os.Getenv("PULSEC_BIN")
	if bin == "" {
		t.Skip("set PULSEC_BIN to an absolute path to the candidate")
	}
	// Reserve two distinct addresses while generating fixture paths.
	choose := func() net.Listener {
		ln, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		return ln
	}
	first, second := choose(), choose()
	plain, secure := first.Addr().String(), second.Addr().String()
	root := t.TempDir()
	challenge := filepath.Join(root, ".well-known", "acme-challenge")
	published, err := os.OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = published.Close() }()
	bundle := filepath.Join(published.Name(), "site.pem")
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Second)
	defer cancel()
	// #nosec G204 G702 -- the operator supplies this local QA artifact.
	proc := exec.CommandContext(ctx, bin, "-addr", secure, "-http-addr", plain, "-public-host", "chat.example.test", "-acme-webroot", root, "-cert", bundle, "-key", bundle)
	proc.Dir = t.TempDir()
	proc.Env = []string{"PATH=" + proc.Dir}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	if err := proc.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); _ = proc.Wait() }()

	client := http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	req, err := http.NewRequestWithContext(ctx, "GET", "http://"+plain+"/chat?room=public", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Host = "attacker.test"
	var response *http.Response
	for end := time.Now().Add(4 * time.Second); time.Now().Before(end); {
		if response, err = client.Do(req); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 308 || response.Header.Get("Location") != "https://chat.example.test/chat?room=public" {
		t.Fatal("wrong direct redirect", response.Status)
	}
	if ln, err := net.DialTimeout("tcp", secure, 200*time.Millisecond); err == nil {
		_ = ln.Close()
		t.Fatal("secure TCP bound before certificate issuance")
	}
	udp, err := net.ListenPacket("udp4", secure)
	if err != nil {
		t.Fatal("secure UDP bound before certificate issuance", err)
	}
	_ = udp.Close()
	if err := os.MkdirAll(challenge, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(challenge, "test-token"), []byte("test-authorization"), 0600); err != nil {
		t.Fatal(err)
	}
	testChallenge := func() {
		t.Helper()
		resp, err := client.Get("http://" + plain + "/.well-known/acme-challenge/test-token")
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		data, err := io.ReadAll(resp.Body)
		if err != nil || resp.StatusCode != 200 || string(data) != "test-authorization" {
			t.Fatal("challenge unavailable", resp.Status, err)
		}
	}
	testChallenge()

	// Certbot publishes the chain and key together with one rename. No process
	// signal or container restart occurs on either publication.
	publish := func(serial int64) *x509.CertPool {
		t.Helper()
		cert, key, roots := testPEM(t, serial)
		if err := published.WriteFile("site.tmp", append(cert, key...), 0600); err != nil {
			t.Fatal(err)
		}
		if err := published.Rename("site.tmp", "site.pem"); err != nil {
			t.Fatal(err)
		}
		return roots
	}
	origin := "https://" + secure
	waitForHandshake := func(roots *x509.CertPool, timeout time.Duration) string {
		t.Helper()
		cfg := &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}
		https := http.Client{Timeout: time.Second, Transport: &http.Transport{TLSClientConfig: cfg, DisableKeepAlives: true}}
		deadline := time.Now().Add(timeout)
		for {
			res, err := https.Get(origin + "/config")
			if err == nil {
				var state struct{ Boot, Pin string }
				err = json.NewDecoder(res.Body).Decode(&state)
				_ = res.Body.Close()
				if err != nil || res.StatusCode != 200 || state.Boot == "" || state.Pin != "" {
					t.Fatal("invalid public TLS config", err)
				}
				tr := wt.Transport{TLSClientConfig: cfg.Clone()}
				defer func() { _ = tr.Close() }()
				_, session, err := tr.Dial(ctx, origin+"/connect", http.Header{"Origin": {origin}})
				if err != nil {
					t.Fatal("QUIC certificate did not match HTTPS certificate", err)
				}
				_ = session.CloseWithError(0, "done")
				return state.Boot
			}
			if time.Now().After(deadline) {
				t.Fatal("published certificate was not activated", err)
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
	boot := waitForHandshake(publish(3), 8*time.Second)
	if got := waitForHandshake(publish(4), 35*time.Second); got != boot {
		t.Fatal("restart during certificate rotation")
	}
	testChallenge()
}
