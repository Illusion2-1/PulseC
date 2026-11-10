package server

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/quic-go/quic-go/http3"
	wt "github.com/quic-go/webtransport-go"

	"pulsec/internal/chat"
)

// Exercise framing over the production QUIC, HTTP/3 and WebTransport stack.
// A bad client must be disconnected before any following command is processed.
func TestRejectBadFramesOverWebTransport(t *testing.T) {
	cert, _, err := localCert()
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(leaf)
	listener, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	origin := "https://" + listener.LocalAddr().String()
	h := chat.NewHub(128)
	mux := http.NewServeMux()
	wtServer := &wt.Server{H3: &http3.Server{TLSConfig: http3.ConfigureTLSConfig(&tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}), Handler: browserHeaders(false, mux)}}
	gate := newIngress(8)
	gate.configure(wtServer)
	mux.HandleFunc("/connect", gate.connect(wtServer, h, false))
	done := make(chan error, 1)
	go func() { done <- wtServer.Serve(listener) }()
	t.Cleanup(func() { _ = wtServer.Close(); _ = listener.Close(); <-done })
	dial := func() (*wt.Stream, *wt.Session) {
		tr := &wt.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}}
		t.Cleanup(func() { _ = tr.Close() })
		ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
		defer cancel()
		_, sess, err := tr.Dial(ctx, origin+"/connect", http.Header{"Origin": {origin}})
		if err != nil {
			t.Fatal(err)
		}
		stream, err := sess.OpenStreamSync(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err = stream.SetDeadline(time.Now().Add(4 * time.Second)); err != nil {
			t.Fatal(err)
		}
		return stream, sess
	}
	healthy, _ := dial()
	reader := bufio.NewReader(healthy)
	// Send a ping to materialise the healthy bidirectional stream on the server.
	first := true
	ping := func() {
		if _, err := healthy.Write([]byte("{\"op\":\"ping\",\"id\":\"alive\"}\n")); err != nil {
			t.Fatal(err)
		}
		if first {
			info, err := reader.ReadBytes('\n')
			var event struct{ Op, Transport, Encryption string }
			if err != nil || json.Unmarshal(info, &event) != nil || event.Op != "connection" || event.Transport != "WebTransport" || event.Encryption != tls.VersionName(tls.VersionTLS13) {
				t.Fatal("missing negotiated connection info", string(info), err)
			}
			first = false
		}
		reply, err := reader.ReadString('\n')
		if err != nil || !strings.Contains(reply, "\"pong\"") {
			t.Fatal("healthy stream failed", reply, err)
		}
	}
	ping()
	for _, frame := range [][]byte{bytes.Repeat([]byte("x"), 32768), []byte("{broken}"), []byte("{\"op\":\"ping\",\"id\":\"\xff\"}")} {
		stream, sess := dial()
		if _, err := stream.Write(append(frame, []byte("\n{\"op\":\"ping\"}\n")...)); err != nil {
			t.Fatal(err)
		}
		scan := bufio.NewScanner(stream)
		for scan.Scan() {
			var event struct{ Op string }
			if json.Unmarshal(scan.Bytes(), &event) != nil || event.Op != "connection" {
				t.Fatalf("bad frame produced a reply: %s", scan.Bytes())
			}
		}
		if err := scan.Err(); err == nil || os.IsTimeout(err) {
			t.Fatalf("bad frame not rejected: %v", err)
		}
		_ = sess.CloseWithError(0, "")
	}
	ping()
}

func TestIngressBoundaries(t *testing.T) {
	g := newIngress(1)
	if !g.acquire() || g.acquire() {
		t.Fatal("capacity exceeded")
	}
	<-g.slots
	if !g.acquire() {
		t.Fatal("slot did not become reusable")
	}
	for _, tc := range []struct {
		host    string
		local   bool
		origins []string
		want    int
	}{
		{"malicious.example:8443", true, []string{"http://malicious.example:8443"}, 403},
		{"127.0.0.1:8443", true, []string{"http://evil.test"}, 403},
		{"localhost:8443", true, nil, 403},
		{"localhost:8443", true, []string{"http://localhost:8443", "http://localhost:8443"}, 403},
		{"[::1]:8443", true, []string{"http://[::1]:8443"}, 503},
		{"chat.example", false, []string{"http://chat.example"}, 403},
		{"chat.example", false, []string{"https://chat.example"}, 503},
	} {
		r := httptest.NewRequest(http.MethodGet, "https://example.test/connect", nil)
		r.Method = http.MethodConnect
		r.ProtoMajor = 3
		r.Host = tc.host
		r.Header["Origin"] = tc.origins
		w := httptest.NewRecorder()
		browserHeaders(tc.local, g.connect(nil, nil, tc.local)).ServeHTTP(w, r)
		if w.Code != tc.want || w.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Errorf("host=%s got %d", tc.host, w.Code)
		}
	}
}
