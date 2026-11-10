package qa

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	wt "github.com/quic-go/webtransport-go"
)

func TestProxiedOrigin(t *testing.T) {
	endpoint := os.Getenv("PULSEC_QA_EDGE")
	if endpoint == "" {
		t.Skip("started by qa/caddy.sh")
	}
	// The harness selects its newly generated fixture directory. Confine reads to the fixed certificate filename.
	dir, err := os.OpenRoot(os.Getenv("PULSEC_QA_EDGE_DIR"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dir.Close() })
	cert, err := dir.ReadFile("edge.crt")
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(cert) {
		t.Fatal("invalid fixture certificate")
	}
	const room = "edgeqa"
	a := churnDial(t, endpoint, roots, room, 1)
	defer a.close()
	b := churnDial(t, endpoint, roots, room, 2)
	defer b.close()
	const msg = "through-edge"
	const id = "11111111-1111-1111-1111-111111111111"
	if _, err := fmt.Fprintf(a.stream, "{\"op\":\"send\",\"kind\":\"chat\",\"room\":%q,\"id\":%q,\"text\":%q}\n", room, id, msg); err != nil {
		t.Fatal(err)
	}
	for {
		event := a.read(t)
		if event.Op == "ack" && event.ID == id {
			break
		}
	}
	if event := b.read(t); event.Op != "message" || event.Text != msg || event.Room != room {
		t.Fatal("lost peer delivery", event.Op)
	}
	// Each new identity stays within its own six-message allowance. Both consume
	// the same loopback UDP peer's source bucket behind Caddy (-source-rate 2).
	limited := false
	for n := range 6 {
		c := []*churnClient{a, b}[n%2]
		id := fmt.Sprintf("%036x", n+20)
		if _, err := fmt.Fprintf(c.stream, "{\"op\":\"send\",\"kind\":\"chat\",\"room\":%q,\"id\":%q,\"text\":\"budget\"}\n", room, id); err != nil {
			t.Fatal(err)
		}
		if err := c.stream.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
			t.Fatal(err)
		}
		op := ""
		for c.reader.Scan() {
			var e churnEvent
			if err := json.Unmarshal(c.reader.Bytes(), &e); err != nil {
				t.Fatal(err)
			}
			if e.ID == id {
				op = e.Op
				break
			}
		}
		if op == "limited" {
			limited = true
			break
		}
		if op != "ack" {
			t.Fatalf("expected source allowance or rejection, got %q", op)
		}
	}
	if !limited {
		t.Fatal("proxy source budget did not cover both peers")
	}
	for _, origin := range []string{endpoint, "https://foreign.invalid"} {
		tr := &wt.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots}}
		t.Cleanup(func() { _ = tr.Close() })
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		rsp, session, err := tr.Dial(ctx, endpoint+"/connect", http.Header{"Origin": {origin}, "X-Forwarded-Host": {"foreign.invalid"}, "X-Forwarded-For": {"198.51.100.42"}})
		cancel()
		if session != nil {
			_ = session.CloseWithError(0, "done")
		}
		if origin == endpoint {
			if err != nil {
				t.Fatalf("public Origin rejected: %v", err)
			}
		} else {
			if err == nil {
				t.Fatal("foreign Origin accepted")
			}
			if rsp == nil || rsp.StatusCode < 400 {
				t.Fatalf("expected an HTTP rejection, got %v (%v)", rsp, err)
			}
			_ = rsp.Body.Close()
		}
	}
}
