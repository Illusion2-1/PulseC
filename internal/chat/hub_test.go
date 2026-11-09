package chat

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"os"
	"strings"
	"testing"
	"time"

	"pulsec/internal/protocol"
)

type event map[string]any

func events(t *testing.T, p *Peer) []event {
	t.Helper()
	var list []event
	for len(p.send) > 0 {
		var e event
		if err := json.Unmarshal(<-p.send, &e); err != nil {
			t.Fatal(err)
		}
		list = append(list, e)
	}
	return list
}

func TestRelayDelivery(t *testing.T) {
	h := NewHub(128)
	join := func(n, cred string) *Peer {
		p := NewPeer(netip.Addr{})
		h.Handle(p, protocol.Command{Op: "identity", Nick: n, Proof: strings.Repeat(cred, 64)})
		h.Handle(p, protocol.Command{Op: "join", Room: "room"})
		return p
	}
	a := join("A", "a")
	b := join("B", "b")
	send := protocol.Command{Op: "send", Kind: "chat", Room: "room", Text: "first", ID: fmt.Sprintf("%036d", 0)}
	h.Handle(a, send)
	c := join("B", "c")
	for _, e := range events(t, c) {
		if e["op"] == "message" {
			t.Fatal("late join replayed chat")
		}
	}
	events(t, b)
	events(t, a)
	h.Handle(a, send)
	if len(events(t, b)) != 0 || events(t, a)[0]["op"] != "ack" {
		t.Fatal("retry was not idempotent")
	}
	send.ID = fmt.Sprintf("%036d", 1)
	send.Kind = "whisper"
	send.To = "B"
	h.Handle(a, send)
	if events(t, a)[0]["op"] != "error" {
		t.Fatal("ambiguous whisper")
	}
	send.To = "B#" + b.trip
	h.Handle(a, send)
	if len(events(t, c)) != 0 || events(t, b)[0]["kind"] != "whisper" {
		t.Fatal("whisper recipients")
	}
	send.Kind = "chat"
	for i := 2; i < 6; i++ {
		send.ID = fmt.Sprintf("%036d", i)
		h.Handle(a, send)
	}
	h.Remove(a)
	a = join("A", "a")
	events(t, a)
	send.ID = fmt.Sprintf("%036d", 6)
	h.Handle(a, send)
	if events(t, a)[0]["op"] != "limited" {
		t.Fatal("reconnect reset limiter")
	}
	h.Handle(c, protocol.Command{Op: "directory"})
	var rows []any
	for _, e := range events(t, c) {
		if e["op"] == "directory" {
			rows = e["rooms"].([]any)
		}
	}
	if len(rows) != 0 {
		t.Fatal("unlisted channel leaked")
	}
	h.Remove(a)
	h.Remove(b)
	h.Remove(c)
	if len(h.rooms) != 0 || len(h.peers) != 0 {
		t.Fatal("empty room retained")
	}
}

func TestActivityWindow(t *testing.T) {
	r := channel{minute: 100}
	r.bins[29] = 3
	r.advance(101 * 60)
	if r.bins[28] != 3 || r.bins[29] != 0 {
		t.Fatal("wrong minute")
	}
	r.advance(time.Now().Unix())
	if r.bins != [30]int{} {
		t.Fatal("stale count")
	}
}

// Two browser tabs can legitimately share the same trip and nickname. Roster
// changes must identify the connection, including when older clients share a room.
func TestRosterAcrossProtocolVersions(t *testing.T) {
	h := NewHub(128)
	join := func(delta bool) *Peer {
		p := NewPeer(netip.Addr{})
		h.Handle(p, protocol.Command{Op: "identity", Nick: "twin", Proof: strings.Repeat("a", 64), RosterDelta: delta})
		h.Handle(p, protocol.Command{Op: "join", Room: "room"})
		return p
	}
	legacy := join(false)
	first := join(true)
	second := join(true)
	e := events(t, second)
	snapshot := e[len(e)-1]
	if snapshot["op"] != "state" || len(snapshot["users"].([]any)) != 3 {
		t.Fatal("new subscriber needs full roster", snapshot)
	}
	e = events(t, first)
	last := e[len(e)-1]
	if last["op"] != "member" || last["action"] != "join" {
		t.Fatal("expected incremental join", last)
	}
	target := last["user"].(map[string]any)["id"]
	if target != float64(second.memberID) || first.memberID == second.memberID {
		t.Fatal("identical identities need distinct roster entries")
	}
	h.Handle(second, protocol.Command{Op: "nick", Nick: "new"})
	e = events(t, first)
	if len(e) != 1 || e[0]["action"] != "nick" || e[0]["user"].(map[string]any)["id"] != target || e[0]["user"].(map[string]any)["nick"] != "new" {
		t.Fatal("rename", e)
	}
	h.Remove(second)
	e = events(t, first)
	if len(e) != 1 || e[0]["action"] != "leave" || e[0]["user"].(map[string]any)["id"] != target {
		t.Fatal("leave", e)
	}
	e = events(t, legacy)
	for _, v := range e {
		if v["op"] == "member" {
			t.Fatal("legacy client received delta")
		}
	}
	snapshot = e[len(e)-1]
	if snapshot["op"] != "state" || len(snapshot["users"].([]any)) != 2 {
		t.Fatal("legacy client did not receive up-to-date snapshot", snapshot)
	}
}

func TestProtocolExamples(t *testing.T) {
	data, err := os.ReadFile("../../testdata/protocol.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Setup   string
		Command protocol.Command
		Event   event
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	h := NewHub(128)
	for _, tc := range cases {
		p := NewPeer(netip.Addr{})
		if tc.Setup == "member" {
			h.Handle(p, protocol.Command{Op: "identity", Nick: "reader", Proof: strings.Repeat("1", 64)})
			h.Handle(p, protocol.Command{Op: "join", Room: "room"})
			events(t, p)
		}
		if !h.Handle(p, tc.Command) {
			t.Fatalf("unexpected disconnect for %s", tc.Command.Op)
		}
		got := events(t, p)
		if len(got) != 1 {
			t.Fatalf("command %s got %v", tc.Command.Op, got)
		}
		for k, want := range tc.Event {
			if got[0][k] != want {
				t.Errorf("%s: %s=%v; want %v", tc.Command.Op, k, got[0][k], want)
			}
		}
		if tc.Event["op"] == "error" && (got[0]["text"] == "" || got[0]["id"] != tc.Command.ID || got[0]["room"] != tc.Command.Room) {
			t.Errorf("missing legacy fields: %v", got[0])
		}
		h.Remove(p)
	}
}
