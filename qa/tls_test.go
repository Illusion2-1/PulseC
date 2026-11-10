package qa

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	wt "github.com/quic-go/webtransport-go"
)

// Use a fresh private trust root per rotation. The public listener gets no development pin.
func testPEM(t *testing.T, serial int64) ([]byte, []byte, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: "PulseC QA"},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour),
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}, KeyUsage: x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, &cert, &cert, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	private, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: private}), pool
}

func testCertificate(t *testing.T, serial int64) (string, string, *x509.CertPool) {
	t.Helper()
	chain, key, roots := testPEM(t, serial)
	dir := t.TempDir()
	certPath, keyPath := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	if err := os.WriteFile(certPath, chain, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, key, 0600); err != nil {
		t.Fatal(err)
	}
	return certPath, keyPath, roots
}

func TestProductionTLSRotation(t *testing.T) {
	bin := os.Getenv("PULSEC_BIN")
	if bin == "" {
		t.Skip("set PULSEC_BIN to an absolute path to the candidate")
	}
	if runtime.GOOS == "windows" {
		t.Skip("SIGHUP requires Unix signals")
	}
	port, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := port.Addr().String()
	if err := port.Close(); err != nil {
		t.Fatal(err)
	}
	origin := "https://" + addr
	cert, key, original := testCertificate(t, 1)
	replacementCert, replacementKey, renewed := testCertificate(t, 2)

	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	// #nosec G204 G702 -- the operator supplies the local release artifact under test.
	proc := exec.CommandContext(ctx, bin, "-addr", addr, "-cert", cert, "-key", key)
	proc.Dir = t.TempDir()
	proc.Env = []string{"PATH=" + proc.Dir}
	diagnostic, err := os.CreateTemp(t.TempDir(), "relay.log")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = diagnostic.Close() }()
	proc.Stderr = diagnostic
	if err := proc.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); _ = proc.Wait() }()

	// Each probe uses a new connection and trust pool. IP-literal requests also
	// exercise GetCertificate without SNI.
	getBoot := func(roots *x509.CertPool) (string, error) {
		h := http.Client{Timeout: time.Second, Transport: &http.Transport{DisableKeepAlives: true, TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}}}
		res, err := h.Get(origin + "/config")
		if err != nil {
			return "", err
		}
		defer func() { _ = res.Body.Close() }()
		var cfg struct{ Pin, Boot string }
		if err = json.NewDecoder(res.Body).Decode(&cfg); err != nil {
			return "", err
		}
		if res.StatusCode != 200 || cfg.Pin != "" || cfg.Boot == "" {
			return "", fmt.Errorf("unexpected TLS-mode config on HTTP %d", res.StatusCode)
		}
		return cfg.Boot, nil
	}
	dial := func(roots *x509.CertPool) (*wt.Session, error) {
		tr := &wt.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}}
		t.Cleanup(func() { _ = tr.Close() })
		_, sess, err := tr.Dial(ctx, origin+"/connect", http.Header{"Origin": {origin}})
		return sess, err
	}
	boot := ""
	for deadline := time.Now().Add(4 * time.Second); time.Now().Before(deadline); {
		if boot, err = getBoot(original); err == nil {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if err != nil || boot == "" {
		t.Fatal("listener failed to start", err)
	}

	// Keep this exact chat stream across both reloading attempts.
	sess, err := dial(original)
	if err != nil {
		t.Fatal(err)
	}
	stream, err := sess.OpenStreamSync(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fmt.Fprintf(stream, "{\"op\":\"identity\",\"nick\":\"Probe\",\"proof\":%q}\n{\"op\":\"join\",\"room\":\"rotation\"}\n", strings.Repeat("1", 64)); err != nil {
		t.Fatal(err)
	}
	scan := bufio.NewScanner(stream)
	send := func(n int) {
		t.Helper()
		if err := stream.SetDeadline(time.Now().Add(2 * time.Second)); err != nil {
			t.Fatal(err)
		}
		id := fmt.Sprintf("%036d", n)
		text := fmt.Sprintf("rotation-%d", n)
		if _, err := fmt.Fprintf(stream, "{\"op\":\"send\",\"room\":\"rotation\",\"kind\":\"chat\",\"text\":%q,\"id\":%q}\n", text, id); err != nil {
			t.Fatal(err)
		}
		received := false
		for scan.Scan() {
			var event struct{ Op, Room, ID, Text string }
			if err := json.Unmarshal(scan.Bytes(), &event); err != nil {
				t.Fatal(err)
			}
			switch event.Op {
			case "message":
				received = event.Room == "rotation" && event.Text == text
			case "ack":
				if !received || event.ID != id {
					t.Fatal("incomplete delivery on existing session")
				}
				return
			case "error", "limited":
				t.Fatal("existing session rejected", event.Op)
			}
		}
		t.Fatal("lost chat stream", scan.Err())
	}
	send(1)
	reload := func(want string) {
		t.Helper()
		if err := proc.Process.Signal(syscall.SIGHUP); err != nil {
			t.Fatal(err)
		}
		for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); {
			data, err := os.ReadFile(diagnostic.Name())
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(data, []byte(want)) {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("relay did not report %q", want)
	}
	fresh := func(roots *x509.CertPool) {
		t.Helper()
		if got, err := getBoot(roots); err != nil || got != boot {
			t.Fatalf("new HTTPS handshake or boot changed: %v", err)
		}
		s, err := dial(roots)
		if err != nil {
			t.Fatalf("new WebTransport handshake: %v", err)
		}
		_ = s.CloseWithError(0, "done")
	}

	if err := os.Rename(replacementKey, key); err != nil {
		t.Fatal(err)
	}
	reload("certificate reload failed")
	fresh(original)
	send(2)

	if err := os.Rename(replacementCert, cert); err != nil {
		t.Fatal(err)
	}
	reload("certificate reloaded")
	fresh(renewed)
	send(3)
	if _, err := getBoot(original); err == nil {
		t.Fatal("new HTTPS handshake still accepted the previous certificate")
	}
	if unexpected, err := dial(original); err == nil {
		_ = unexpected.CloseWithError(0, "done")
		t.Fatal("new WebTransport handshake still accepted the previous certificate")
	}
}
