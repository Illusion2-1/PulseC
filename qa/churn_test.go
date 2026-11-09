package qa

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	wt "github.com/quic-go/webtransport-go"
)

const churnPeers = 24
const churnSecret = "churn_private_marker" // Only synthetic payloads; must never reach stderr.
type churnClient struct {
	tr      *wt.Transport
	session *wt.Session
	stream  *wt.Stream
	reader  *bufio.Scanner
}

func churnDial(t *testing.T, origin string, roots *x509.CertPool, room string, i int) *churnClient {
	t.Helper()
	tr := &wt.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	_, s, err := tr.Dial(ctx, origin+"/connect", http.Header{"Origin": {origin}})
	if err != nil {
		_ = tr.Close()
		t.Fatal(err)
	}
	stream, err := s.OpenStreamSync(ctx)
	if err != nil {
		_ = tr.Close()
		t.Fatal(err)
	}
	c := &churnClient{tr, s, stream, bufio.NewScanner(stream)}
	if _, err = fmt.Fprintf(stream, "{\"op\":\"identity\",\"rosterDelta\":true,\"nick\":\"q%d\",\"proof\":\"%064x\"}\n{\"op\":\"join\",\"room\":%q}\n", i, i+1, room); err != nil {
		c.close()
		t.Fatal(err)
	}
	for c.read(t).Op != "state" {
	}
	return c
}
func (c *churnClient) close() { _ = c.session.CloseWithError(0, churnSecret); _ = c.tr.Close() }

type churnEvent struct{ Op, Room, Text, ID, Ref string }

func (c *churnClient) read(t *testing.T) churnEvent {
	t.Helper()
	if err := c.stream.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if !c.reader.Scan() {
		t.Fatal("lost stream", c.reader.Err())
	}
	var e churnEvent
	if err := json.Unmarshal(c.reader.Bytes(), &e); err != nil {
		t.Fatal(err)
	}
	if e.Op == "error" || e.Op == "limited" {
		t.Fatal("unexpected rejection", e.Op)
	}
	return e
}
func wave(t *testing.T, origin string, roots *x509.CertPool, index int) {
	t.Helper()
	clients := make([]*churnClient, 0, churnPeers)
	defer func() {
		for _, c := range clients {
			c.close()
		}
	}()
	// All of these connections leave; an unrelated peer remains online throughout.
	room := fmt.Sprintf("%s_%d", churnSecret, index)
	for i := range churnPeers {
		clients = append(clients, churnDial(t, origin, roots, room, 1+index*churnPeers+i))
	}
	for i, c := range clients {
		if _, err := fmt.Fprintf(c.stream, "{\"op\":\"send\",\"kind\":\"chat\",\"room\":%q,\"text\":%q,\"id\":\"%036x\"}\n", room, churnSecret, 1+index*churnPeers+i); err != nil {
			t.Fatal(err)
		}
	}
	for i, c := range clients {
		seen := map[string]bool{}
		acked := false
		for !acked || len(seen) < churnPeers {
			e := c.read(t)
			switch e.Op {
			case "ack":
				if acked || e.ID != fmt.Sprintf("%036x", 1+index*churnPeers+i) {
					t.Fatal("wrong ack")
				}
				acked = true
			case "message":
				if e.Room != room || e.Text != churnSecret || e.Ref == "" || seen[e.Ref] {
					t.Fatal("invalid delivery")
				}
				seen[e.Ref] = true
			}
		}
	}
}

type churnLog struct {
	sync.Mutex
	pending []byte
	last    map[string]int
	leaked  bool
}

func (l *churnLog) Write(p []byte) (int, error) {
	l.Lock()
	defer l.Unlock()
	l.pending = append(l.pending, p...)
	for {
		n := bytes.IndexByte(l.pending, '\n')
		if n < 0 {
			break
		}
		line := string(l.pending[:n])
		l.pending = l.pending[n+1:]
		// The synthetic proof and marker occur only in requests or the QUIC close reason.
		if strings.Contains(line, churnSecret) || strings.Contains(line, strings.Repeat("0", 55)) {
			l.leaked = true
		}
		_, fields, ok := strings.Cut(line, "stats ")
		if !ok {
			continue
		}
		next := map[string]int{}
		for _, f := range strings.Fields(fields) {
			k, v, ok := strings.Cut(f, "=")
			if !ok {
				continue
			}
			i, err := strconv.Atoi(v)
			if err == nil {
				next[k] = i
			}
		}
		l.last = next
	}
	return len(p), nil
}
func (l *churnLog) sample() map[string]int { l.Lock(); defer l.Unlock(); return l.last } // published maps are immutable
func procKiB(t *testing.T, pid int, field string) int {
	t.Helper()
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, field+":") {
			a := strings.Fields(line)
			v, err := strconv.Atoi(a[1])
			if err != nil {
				t.Fatal(err)
			}
			return v
		}
	}
	t.Fatal("missing process memory counter", field)
	return 0
}

// This release gate uses real wall time and the production sweep interval. It
// deliberately doesn't trigger GC or turn a particular Linux RSS into a unit assertion.
func TestWebTransportChurn(t *testing.T) {
	bin := os.Getenv("PULSEC_CHURN_BIN")
	if bin == "" {
		t.Skip("set PULSEC_CHURN_BIN to run the nine-minute release soak")
	}
	if runtime.GOOS != "linux" {
		t.Skip("samples /proc RSS on Linux")
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	cert, key, roots := testCertificate(t, 123)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	// #nosec G204 G702 -- opt-in test runs the explicitly supplied local release artifact.
	proc := exec.CommandContext(ctx, bin, "-addr", addr, "-cert", cert, "-key", key, "-stats-interval", "1s")
	proc.Dir = t.TempDir()
	proc.Env = []string{"PATH=" + proc.Dir}
	log := &churnLog{}
	proc.Stderr = log
	if err := proc.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cancel(); _ = proc.Wait() }()
	// Waiting for stats both proves startup and measures a quiet, post-listen RSS.
	for end := time.Now().Add(5 * time.Second); len(log.sample()) == 0; {
		if time.Now().After(end) {
			t.Fatal("missing startup stats")
		}
		time.Sleep(25 * time.Millisecond)
	}
	for _, key := range []string{"sessions", "online", "rooms", "receipts", "limit_trips", "limit_sources"} {
		if _, ok := log.sample()[key]; !ok {
			t.Fatal("missing stats field", key)
		}
	}
	pid := proc.Process.Pid
	idle := procKiB(t, pid, "VmRSS")
	origin := "https://" + addr
	survivor := churnDial(t, origin, roots, "survivor", 0)
	defer func() {
		if survivor != nil {
			survivor.close()
		}
	}()
	ping := func() {
		if _, err := fmt.Fprintln(survivor.stream, `{"op":"ping","id":"ok"}`); err != nil {
			t.Fatal(err)
		}
		for {
			e := survivor.read(t)
			if e.Op == "message" {
				t.Fatal("cross-room delivery")
			}
			if e.Op == "pong" {
				return
			}
		}
	}
	began := time.Now()
	samples := []int{idle}
	maxReceipts := 0
	for i := range 12 {
		wave(t, origin, roots, i)
		ping()
		// Keep each cohort on a fixed schedule; retain only the survivor between waves.
		for time.Since(began) < time.Duration(i+1)*15*time.Second {
			samples = append(samples, procKiB(t, pid, "VmRSS"))
			maxReceipts = max(maxReceipts, log.sample()["receipts"])
			time.Sleep(time.Second)
		}
	}
	if maxReceipts != 12*churnPeers {
		t.Fatalf("peak receipts %d, want %d", maxReceipts, 12*churnPeers)
	}
	activePeak := slices.Max(samples)
	t.Logf("active: 12 waves × %d peers; %d acks / %d deliveries, peak receipts %d; idle RSS %.1f, sampled post-wave peak %.1f MiB", churnPeers, 12*churnPeers, 12*churnPeers*churnPeers, maxReceipts, float64(idle)/1024, float64(activePeak)/1024)
	last := time.Now()
	for {
		st := log.sample()
		if st["sessions"] == 1 && st["rooms"] == 1 && st["online"] == 1 && st["receipts"] == 0 && st["limit_sources"] == 0 && st["limit_trips"] == 0 {
			break
		}
		if time.Since(last) > 6*time.Minute+10*time.Second {
			t.Fatal("metadata not cleared within TTL + sweep", st)
		}
		ping()
		time.Sleep(2 * time.Second)
	}
	survivor.close()
	survivor = nil
	for end := time.Now().Add(6 * time.Second); ; {
		st := log.sample()
		if st["sessions"] == 0 && st["rooms"] == 0 && st["online"] == 0 {
			if st["limited"]+st["protocol_failures"]+st["admission_denied"]+st["slow_disconnects"] != 0 {
				t.Fatal("unexpected failures", st)
			}
			break
		}
		if time.Now().After(end) {
			t.Fatal("last session retained", st)
		}
		time.Sleep(200 * time.Millisecond)
	}
	log.Lock()
	leaked := log.leaked
	log.Unlock()
	if leaked {
		t.Fatal("synthetic secret visible in process stderr")
	}
	t.Logf("quiescent at %s: active sessions, rooms, trips, sources and receipts = 0; sampled final RSS %.1f MiB, kernel peak RSS %.1f MiB; no synthetic message/proof/close marker in stderr", time.Since(began).Round(time.Second), float64(procKiB(t, pid, "VmRSS"))/1024, float64(procKiB(t, pid, "VmHWM"))/1024)
}
