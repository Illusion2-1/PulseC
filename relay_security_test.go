package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"pulsec/internal/protocol"
	"strings"
	"testing"
	"time"
)

func joinedPeer(t *testing.T, h *hub, nick, proof string) *peer {
	t.Helper()
	p := &peer{send: make(chan []byte, 64), rooms: map[string]bool{}, stop: make(chan struct{})}
	h.handle(p, protocol.Command{Op: "identity", Nick: nick, Proof: strings.Repeat(proof, 64), RosterDelta: true})
	h.handle(p, protocol.Command{Op: "join", Room: "room"})
	events(t, p)
	return p
}
func TestAddressAndTopicLimitsSurviveIdentityChanges(t *testing.T) {
	h := newHub()
	h.sourceRate = 1
	a := joinedPeer(t, h, "a", "a")
	b := joinedPeer(t, h, "b", "b")
	a.source = netip.MustParseAddr("192.0.2.1")
	b.source = a.source
	send := func(p *peer, id int, kind string) event {
		events(t, p)
		h.handle(p, protocol.Command{Op: "send", Room: "room", Kind: kind, ID: fmt.Sprintf("%036d", id), Text: "example"})
		list := events(t, p)
		return list[len(list)-1]
	}
	if e := send(a, 1, "chat"); e["op"] != "ack" {
		t.Fatal(e)
	}
	if e := send(a, 2, "topic"); e["op"] != "ack" {
		t.Fatal(e)
	}
	h.remove(a)
	if e := send(b, 3, "chat"); e["op"] != "limited" {
		t.Fatal("rotated identity bypassed source limit", e)
	}
	b.source = netip.MustParseAddr("192.0.2.2")
	if e := send(b, 4, "topic"); e["code"] != "control_limited" {
		t.Fatal("topic limit reset", e)
	}
	if e := send(b, 5, "chat"); e["op"] != "ack" {
		t.Fatal("different source blocked", e)
	}
	h.remove(b)
	h.sweep(time.Now().Add(7 * time.Minute))
	if len(h.sources)+len(h.rooms)+len(h.receipts)+len(h.limits) != 0 {
		t.Fatal("expired metadata retained")
	}
}
func TestAbuseRemainsBounded(t *testing.T) {
	h := newHub()
	a := joinedPeer(t, h, "a", "a")
	// Invalid whisper targets must not consume a receipt or allocate trip history.
	for i := 0; i < 10; i++ {
		h.handle(a, protocol.Command{Op: "send", Room: "room", ID: fmt.Sprintf("%036d", i), Kind: "whisper", To: "missing", Text: "x"})
	}
	if len(h.receipts) != 0 || len(h.limits) != 0 {
		t.Fatal("invalid messages retained state")
	}
	events(t, a)
	h.handle(a, protocol.Command{Op: "directory", Known: make([]string, 51)})
	if e := events(t, a); e[0]["code"] != "too_many_known" {
		t.Fatal(e)
	}
	for len(h.rooms) < maxRooms {
		h.rooms[fmt.Sprint(len(h.rooms))] = &channel{}
	}
	h.handle(a, protocol.Command{Op: "join", Room: "new"})
	if e := events(t, a); e[0]["code"] != "server_busy" {
		t.Fatal(e)
	}
	for i := 0; i < maxReceipts; i++ {
		h.receipts[fmt.Sprint(i)] = receipt{time.Now(), "ref"}
	}
	h.handle(a, protocol.Command{Op: "send", Room: "room", ID: fmt.Sprintf("%036d", 99), Kind: "chat", Text: "x"})
	if e := events(t, a); len(e) != 1 || e[0]["code"] != "server_busy" {
		t.Fatal("accepted without retry capacity", e)
	}
	for range 30 {
		h.handle(a, protocol.Command{Op: "ping"})
	}
	e := events(t, a)
	if e[len(e)-1]["code"] != "control_limited" {
		t.Fatal("control flood allowed")
	}
}
func TestSlowRecipientDoesNotBlockOtherRecipients(t *testing.T) {
	h := newHub()
	a := joinedPeer(t, h, "fast", "a")
	b := joinedPeer(t, h, "slow", "b")
	b.send = make(chan []byte, 1)
	for i := 0; i < 2; i++ {
		h.handle(a, protocol.Command{Op: "send", Room: "room", Kind: "chat", ID: fmt.Sprintf("%036d", i), Text: "x"})
	}
	if !b.stopped || !b.overflow || a.stopped {
		t.Fatal("wrong recipient disconnected")
	}
	var acks int
	for _, e := range events(t, a) {
		if e["op"] == "ack" {
			acks++
		}
	}
	if acks != 2 {
		t.Fatal(acks)
	}
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
func FuzzUntrustedCommand(f *testing.F) {
	f.Add([]byte(`{"op":"directory","known":["secret"]}`))
	f.Add([]byte(`{"op":"send","room":"room","kind":"whisper","to":"a"}`))
	f.Add([]byte(`{"op":"identity","proof":42}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		c, err := protocol.Decode(raw)
		if err != nil {
			return
		}
		h := newHub()
		p := &peer{send: make(chan []byte, 64), rooms: map[string]bool{}, stop: make(chan struct{})}
		h.handle(p, c)
		if len(h.receipts) != 0 || len(h.rooms) != 0 {
			t.Fatal("unidentified peer created room or sent message")
		}
	})
}
