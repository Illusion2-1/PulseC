package qa

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
	"time"

	wt "github.com/quic-go/webtransport-go"
)

func TestDirectHTTP01Bootstrap(t *testing.T) {
	bin := os.Getenv("PULSEC_BIN")
	if bin == "" || runtime.GOOS == "windows" {
		t.Skip("requires candidate executable and Unix signals")
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
	cert := filepath.Join(t.TempDir(), "chain.pem")
	key := filepath.Join(t.TempDir(), "key.pem")
	issuedCert, issuedKey, roots := testCertificate(t, 3)
	ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
	defer cancel()
	// #nosec G204 G702 -- the operator supplies this local QA artifact.
	proc := exec.CommandContext(ctx, bin, "-addr", secure, "-http-addr", plain, "-public-host", "chat.example.test", "-acme-webroot", root, "-cert", cert, "-key", key)
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

	if err := os.Rename(issuedCert, cert); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(issuedKey, key); err != nil {
		t.Fatal(err)
	}
	if err := proc.Process.Signal(syscall.SIGHUP); err != nil {
		t.Fatal(err)
	}
	origin := "https://" + secure
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}
	https := http.Client{Timeout: time.Second, Transport: &http.Transport{TLSClientConfig: tlsConfig}}
	defer https.CloseIdleConnections()
	for end := time.Now().Add(4 * time.Second); time.Now().Before(end); {
		response, err = https.Get(origin + "/config")
		if err == nil {
			break
		}
		if !errors.Is(err, syscall.ECONNREFUSED) {
			t.Fatal("secure startup", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct{ Boot, Pin string }
	err = json.NewDecoder(response.Body).Decode(&cfg)
	_ = response.Body.Close()
	if err != nil || response.StatusCode != 200 || cfg.Boot == "" || cfg.Pin != "" {
		t.Fatal("missing production HTTPS configuration", err)
	}
	tr := wt.Transport{TLSClientConfig: tlsConfig.Clone()}
	defer func() { _ = tr.Close() }()
	_, session, err := tr.Dial(ctx, origin+"/connect", http.Header{"Origin": {origin}})
	if err != nil {
		t.Fatal("QUIC did not serve issued certificate", err)
	}
	_ = session.CloseWithError(0, "done")
	testChallenge() // Port 80 stays available for renewal.
}
