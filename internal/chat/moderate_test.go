package chat

import (
	"fmt"
	"net/netip"
	"strings"
	"testing"

	"pulsec/internal/protocol"
)

func TestModeration(t *testing.T) {
	h := NewHub(128)
	join := func(n, cred, room string) *Peer {
		p := NewPeer(netip.Addr{})
		h.Handle(p, protocol.Command{Op: "identity", Nick: n, Proof: strings.Repeat(cred, 64), RosterDelta: true})
		h.Handle(p, protocol.Command{Op: "join", Room: room})
		return p
	}
	last := func(p *Peer, op string) event {
		t.Helper()
		var found event
		for _, e := range events(t, p) {
			if e["op"] == op {
				found = e
			}
		}
		if found == nil {
			t.Fatalf("no %s event", op)
		}
		return found
	}
	mod := func(p *Peer, action, target string, on bool, rate int) {
		h.Handle(p, protocol.Command{Op: "moderate", Room: "ctf", Action: action, Target: target, On: on, Rate: rate})
	}
	owner := join("m4x", "a", "ctf")
	if s := last(owner, "state"); s["owner"] != owner.trip {
		t.Fatal("creator owns the room", s)
	}
	b := join("bob", "b", "ctf")
	c := join("cat", "c", "ctf")
	events(t, b)
	events(t, c)

	mod(b, "lock", "", true, 0)
	if e := last(b, "error"); e["code"] != "not_admin" {
		t.Fatal("non-admin moderated", e)
	}

	mod(owner, "op", b.trip, true, 0)
	if s := last(c, "state"); len(s["mods"].([]any)) != 1 {
		t.Fatal("op not reflected in state", s)
	}
	events(t, owner)
	events(t, b)
	mod(b, "op", c.trip, true, 0)
	if e := last(b, "error"); e["code"] != "not_admin" {
		t.Fatal("only the owner appoints mods", e)
	}
	mod(b, "kick", owner.trip, true, 0)
	if e := last(b, "error"); e["code"] != "invalid_target" {
		t.Fatal("mod acted on owner", e)
	}

	mod(b, "mute", c.trip, true, 0)
	if e := last(c, "moderation"); e["action"] != "mute" || e["target"] != c.trip || e["nick"] != "cat" {
		t.Fatal("mute event", e)
	}
	send := protocol.Command{Op: "send", Room: "ctf", Kind: "chat", Text: "x", ID: fmt.Sprintf("%036d", 1)}
	h.Handle(c, send)
	if e := last(c, "error"); e["code"] != "room_muted" {
		t.Fatal("muted member spoke", e)
	}
	mod(b, "unmute", c.trip, false, 0)
	events(t, c)
	h.Handle(c, send)
	if last(c, "ack") == nil {
		t.Fatal("unmuted member silenced")
	}

	mod(owner, "slow", "", true, 9)
	if e := last(owner, "error"); e["code"] != "invalid_rate" {
		t.Fatal("slow mode looser than global limit", e)
	}
	mod(owner, "slow", "", true, 1)
	events(t, c)
	for i := 2; i < 4; i++ { // one allowed, the next held back
		send.ID = fmt.Sprintf("%036d", i)
		h.Handle(c, send)
	}
	if e := last(c, "limited"); e["wait"].(float64) <= 0 {
		t.Fatal("room slow mode not enforced", e)
	}
	events(t, owner)
	for i := 10; i < 12; i++ {
		h.Handle(owner, protocol.Command{Op: "send", Room: "ctf", Kind: "chat", Text: "y", ID: fmt.Sprintf("%036d", i)})
	}
	for _, e := range events(t, owner) {
		if e["op"] == "limited" {
			t.Fatal("admins are exempt from slow mode")
		}
	}

	mod(owner, "slow", "", false, 0)
	mod(owner, "topiclock", "", true, 0)
	events(t, c)
	h.Handle(c, protocol.Command{Op: "send", Room: "ctf", Kind: "topic", Text: "t", ID: fmt.Sprintf("%036d", 5)})
	if e := last(c, "error"); e["code"] != "topic_locked" {
		t.Fatal("topic lock", e)
	}

	mod(owner, "ban", c.trip, true, 0)
	if e := last(c, "moderation"); e["action"] != "ban" {
		t.Fatal("target hears its own ban", e)
	}
	if c.rooms["ctf"] || h.rooms["ctf"].members[c] {
		t.Fatal("banned member stayed")
	}
	again := join("cat", "c", "ctf")
	if e := last(again, "error"); e["code"] != "room_banned" {
		t.Fatal("banned trip rejoined", e)
	}
	mod(owner, "unban", c.trip, false, 0)
	mod(owner, "lock", "", true, 0)
	h.Handle(again, protocol.Command{Op: "join", Room: "ctf"})
	if e := last(again, "error"); e["code"] != "room_locked" {
		t.Fatal("locked room admitted a newcomer", e)
	}
	// The owner keeps the role across reconnects while the room exists.
	h.Remove(owner)
	back := join("m4x", "a", "ctf")
	mod(back, "lock", "", false, 0)
	if s := last(back, "state"); s["locked"] != false {
		t.Fatal("returning owner lost admin", s)
	}

	lobby := join("x", "d", "lobby")
	if s := last(lobby, "state"); s["owner"] != "" {
		t.Fatal("#lobby has no admin", s)
	}
}

func TestColor(t *testing.T) {
	h := NewHub(128)
	join := func(cred, color string) *Peer {
		p := NewPeer(netip.Addr{})
		h.Handle(p, protocol.Command{Op: "identity", Nick: "n", Proof: strings.Repeat(cred, 64), RosterDelta: true, Color: color})
		h.Handle(p, protocol.Command{Op: "join", Room: "room"})
		return p
	}
	a := join("a", "#ff8800")
	b := join("b", "javascript:")
	if a.color != "#ff8800" || b.color != "" {
		t.Fatal("identity colour", a.color, b.color)
	}
	events(t, a)
	events(t, b)
	h.Handle(b, protocol.Command{Op: "color", Color: "#00FF00"})
	if e := events(t, b); e[0]["code"] != "invalid_color" {
		t.Fatal("colour validation", e)
	}
	h.Handle(b, protocol.Command{Op: "color", Color: "#00ff00"})
	if e := events(t, b); e[0]["op"] != "color" || e[0]["color"] != "#00ff00" {
		t.Fatal("colour confirmation", e)
	}
	e := events(t, a)
	if e[0]["action"] != "color" || e[0]["user"].(map[string]any)["color"] != "#00ff00" {
		t.Fatal("colour change not broadcast", e)
	}
	h.Handle(b, protocol.Command{Op: "send", Room: "room", Kind: "chat", Text: "hi", ID: fmt.Sprintf("%036d", 0)})
	if e := events(t, a); e[0]["color"] != "#00ff00" {
		t.Fatal("message colour", e)
	}
}
