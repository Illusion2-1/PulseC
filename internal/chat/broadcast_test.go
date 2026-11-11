package chat

import (
	"bytes"
	"strconv"
	"strings"
	"testing"
	"time"

	"pulsec/internal/protocol"
)

func broadcastRoom(size int) (*channel, []*Peer) {
	room := &channel{members: make(map[*Peer]bool, size)}
	peers := make([]*Peer, size)
	for i := range peers {
		p := &Peer{send: make(chan []byte, 1), stop: make(chan struct{})}
		room.members[p] = true
		peers[i] = p
	}
	return room, peers
}

func broadcastChat(room *channel, text string) {
	cmd := protocol.Command{Room: "hot", Kind: "chat", Text: text}
	sender := protocol.Member{Nick: "guest", Trip: "1234567890abcdef"}
	room.broadcast(protocol.Message(cmd, sender, "012345abcdef", 123, ""))
}

func TestSharedBroadcast(t *testing.T) {
	room, peers := broadcastRoom(512)
	peers[0].send <- []byte("occupied")
	done := make(chan struct{})
	go func() {
		broadcastChat(room, "first")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a full queue blocked the broadcast")
	}
	if !peers[0].overflow || !peers[0].stopped {
		t.Fatal("full queue did not retire")
	}
	first, _ := peers[1].Next(t.Context())
	for _, p := range peers[2:] {
		frame, _ := p.Next(t.Context())
		if &frame[0] != &first[0] {
			t.Fatal("one broadcast allocated per-recipient frames")
		}
	}
	broadcastChat(room, "second")
	second, _ := peers[1].Next(t.Context())
	if !bytes.Contains(first, []byte("first")) || !bytes.Contains(second, []byte("second")) {
		t.Fatal("later broadcast lost or overwrote in-flight data")
	}
}

// Include encoding and enqueueing one broadcast, then drain every queue before the next.
func BenchmarkBroadcast(b *testing.B) {
	for _, size := range []int{1, 512} {
		b.Run(strconv.Itoa(size), func(b *testing.B) {
			room, peers := broadcastRoom(size)
			text := strings.Repeat("x", 128)
			b.ReportAllocs()
			for b.Loop() {
				broadcastChat(room, text)
				for _, p := range peers {
					p.Next(b.Context())
				}
			}
		})
	}
}
