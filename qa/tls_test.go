package qa

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	wt "github.com/quic-go/webtransport-go"
)

// Use a fresh private trust root per rotation. The public listener gets no development pin.
func testCertificate(t *testing.T, serial int64) (string, string, *x509.CertPool) {
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
	dir := t.TempDir()
	write := func(name, kind string, data []byte) string {
		file := filepath.Join(dir, name)
		if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: data}), 0600); err != nil {
			t.Fatal(err)
		}
		return file
	}
	return write("cert.pem", "CERTIFICATE", der), write("key.pem", "EC PRIVATE KEY", private), pool
}

func TestProductionTLSRotation(t *testing.T) {
	bin := os.Getenv("PULSEC_BIN")
	if bin == "" {
		t.Skip("set PULSEC_BIN to an absolute path to the candidate")
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
	var oldRoots *x509.CertPool
	client := func(roots *x509.CertPool) *http.Client {
		return &http.Client{Timeout: time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}}}
	}
	for serial := int64(1); serial <= 2; serial++ {
		cert, key, roots := testCertificate(t, serial)
		func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			// #nosec G204 -- the operator explicitly supplies the local release artifact under test.
			proc := exec.CommandContext(ctx, bin, "-addr", addr, "-cert", cert, "-key", key)
			proc.Dir = t.TempDir() // no static files and no Node installation on PATH
			proc.Env = []string{"PATH=" + proc.Dir}
			if err := proc.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { cancel(); _ = proc.Wait() }()
			h := client(roots)
			defer h.CloseIdleConnections()
			var res *http.Response
			for deadline := time.Now().Add(4 * time.Second); time.Now().Before(deadline); {
				res, err = h.Get(origin + "/config")
				if err == nil {
					break
				}
				time.Sleep(30 * time.Millisecond)
			}
			if err != nil {
				t.Fatal(err)
			}
			var cfg struct{ Pin, Boot string }
			err = json.NewDecoder(res.Body).Decode(&cfg)
			_ = res.Body.Close()
			if err != nil || res.StatusCode != 200 || cfg.Pin != "" || cfg.Boot == "" {
				t.Fatal("invalid TLS-mode config", err)
			}
			if oldRoots != nil {
				h := client(oldRoots)
				res, err := h.Get(origin + "/config")
				h.CloseIdleConnections()
				if err == nil {
					_ = res.Body.Close()
					t.Fatal("previous certificate still trusted")
				}
			}
			tr := wt.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}}
			defer func() { _ = tr.Close() }()
			_, sess, err := tr.Dial(ctx, origin+"/connect", http.Header{"Origin": {origin}})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = sess.CloseWithError(0, "done") }()
			stream, err := sess.OpenStreamSync(ctx)
			if err != nil {
				t.Fatal(err)
			}
			_ = stream.SetDeadline(time.Now().Add(3 * time.Second))
			if _, err = stream.Write([]byte("{\"op\":\"identity\",\"nick\":\"Probe\",\"proof\":\"" + strings.Repeat("1", 64) + "\"}\n{\"op\":\"ping\",\"id\":\"rotation\"}\n")); err != nil {
				t.Fatal(err)
			}
			scan := bufio.NewScanner(stream)
			for scan.Scan() {
				var msg struct{ Op, ID string }
				if err := json.Unmarshal(scan.Bytes(), &msg); err != nil {
					t.Fatal(err)
				}
				if msg.Op == "pong" && msg.ID == "rotation" {
					return
				}
			}
			t.Fatal("missing pong after TLS rotation", scan.Err())
		}()
		oldRoots = roots
	}
}
