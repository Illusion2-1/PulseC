package chat

import (
	"fmt"
	"net/netip"
	"strings"
	"testing"
	"time"

	"pulsec/internal/protocol"
)

func joinedPeer(t *testing.T, h *Hub, nick, proof string) *Peer {
	t.Helper()
	p := &Peer{send: make(chan []byte, 64), rooms: map[string]bool{}, stop: make(chan struct{})}
	h.Handle(p, protocol.Command{Op: "identity", Nick: nick, Proof: strings.Repeat(proof, 64), RosterDelta: true})
	h.Handle(p, protocol.Command{Op: "join", Room: "room"})
	events(t, p)
	return p
}

func TestAddressAndTopicLimitsSurviveIdentityChanges(t *testing.T) {
	h := NewHub(128)
	h.sourceRate = 1
	a := joinedPeer(t, h, "a", "a")
	b := joinedPeer(t, h, "b", "b")
	a.source = netip.MustParseAddr("192.0.2.1")
	b.source = a.source
	send := func(p *Peer, id int, kind string) event {
		events(t, p)
		h.Handle(p, protocol.Command{Op: "send", Room: "room", Kind: kind, ID: fmt.Sprintf("%036d", id), Text: "example"})
		list := events(t, p)
		return list[len(list)-1]
	}
	if e := send(a, 1, "chat"); e["op"] != "ack" {
		t.Fatal(e)
	}
	if e := send(a, 2, "topic"); e["op"] != "ack" {
		t.Fatal(e)
	}
	h.Remove(a)
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
	h.Remove(b)
	h.Sweep(time.Now().Add(7 * time.Minute))
	if len(h.sources)+len(h.rooms)+len(h.receipts)+len(h.limits) != 0 {
		t.Fatal("expired metadata retained")
	}
}

func TestAbuseRemainsBounded(t *testing.T) {
	h := NewHub(128)
	a := joinedPeer(t, h, "a", "a")
	// Invalid whisper targets must not consume a receipt or allocate trip history.
	for i := 0; i < 10; i++ {
		h.Handle(a, protocol.Command{Op: "send", Room: "room", ID: fmt.Sprintf("%036d", i), Kind: "whisper", To: "missing", Text: "x"})
	}
	if len(h.receipts) != 0 || len(h.limits) != 0 {
		t.Fatal("invalid messages retained state")
	}
	events(t, a)
	h.Handle(a, protocol.Command{Op: "directory", Known: make([]string, 51)})
	if e := events(t, a); e[0]["code"] != "too_many_known" {
		t.Fatal(e)
	}
	for len(h.rooms) < maxRooms {
		h.rooms[fmt.Sprint(len(h.rooms))] = &channel{}
	}
	h.Handle(a, protocol.Command{Op: "join", Room: "new"})
	if e := events(t, a); e[0]["code"] != "server_busy" {
		t.Fatal(e)
	}
	for i := 0; i < maxReceipts; i++ {
		h.receipts[fmt.Sprint(i)] = receipt{time.Now(), "ref"}
	}
	h.Handle(a, protocol.Command{Op: "send", Room: "room", ID: fmt.Sprintf("%036d", 99), Kind: "chat", Text: "x"})
	if e := events(t, a); len(e) != 1 || e[0]["code"] != "server_busy" {
		t.Fatal("accepted without retry capacity", e)
	}
	for range 30 {
		h.Handle(a, protocol.Command{Op: "ping"})
	}
	e := events(t, a)
	if e[len(e)-1]["code"] != "control_limited" {
		t.Fatal("control flood allowed")
	}
}

func TestSlowRecipientDoesNotBlockOtherRecipients(t *testing.T) {
	h := NewHub(128)
	a := joinedPeer(t, h, "fast", "a")
	b := joinedPeer(t, h, "slow", "b")
	b.send = make(chan []byte, 1)
	for i := 0; i < 2; i++ {
		h.Handle(a, protocol.Command{Op: "send", Room: "room", Kind: "chat", ID: fmt.Sprintf("%036d", i), Text: "x"})
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

func FuzzUntrustedCommand(f *testing.F) {
	f.Add([]byte(`{"op":"directory","known":["secret"]}`))
	f.Add([]byte(`{"op":"send","room":"room","kind":"whisper","to":"a"}`))
	f.Add([]byte(`{"op":"identity","proof":42}`))
	f.Fuzz(func(t *testing.T, raw []byte) {
		c, err := protocol.Decode(raw)
		if err != nil {
			return
		}
		h := NewHub(128)
		p := &Peer{send: make(chan []byte, 64), rooms: map[string]bool{}, stop: make(chan struct{})}
		h.Handle(p, c)
		if len(h.receipts) != 0 || len(h.rooms) != 0 {
			t.Fatal("unidentified Peer created room or sent message")
		}
	})
}
