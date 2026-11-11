package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/netip"
	"regexp"
	"sync/atomic"
	"time"

	"pulsec/internal/protocol"
	"pulsec/internal/ratelimit"
)

type Peer struct {
	source        netip.Addr
	controlBudget ratelimit.Bucket
	nick, trip    string
	color         string
	memberID      uint64
	rosterDelta   bool
	rooms         map[string]bool
	send          chan []byte
	queuedBytes   atomic.Int64
	stop          chan struct{}
	stopped       bool
	overflow      bool
	second        int64
	requests      int
	active        int64
}

func NewPeer(source netip.Addr) *Peer {
	return &Peer{source: source.Unmap(), rooms: make(map[string]bool), send: make(chan []byte, 64), stop: make(chan struct{})}
}

// Next returns a read-only frame for the single stream writer.
func (p *Peer) Next(ctx context.Context) ([]byte, bool) {
	select {
	case b := <-p.send:
		p.queuedBytes.Add(-int64(len(b)))
		return b, true
	case <-p.stop:
	case <-ctx.Done():
	}
	return nil, false
}

func (p *Peer) reject(c protocol.Command, problem protocol.Problem) {
	p.queue(protocol.Reject(c, problem))
}

func (p *Peer) allowRequest(now time.Time) bool {
	if p.second != now.Unix() {
		p.second = now.Unix()
		p.requests = 0
	}
	p.requests++
	return !p.stopped && p.requests <= 60
}

func (p *Peer) close() {
	if !p.stopped {
		close(p.stop)
		p.stopped = true
	}
}

// Even a full 4096-member roster fits in one frame. Cap the total as
// well as the frame count so a stalled writer cannot retain 64 snapshots.
const maxQueuedBytes = 1 << 20

func (p *Peer) queue(b []byte) {
	if p.stopped {
		return
	}
	size := int64(len(b))
	if p.queuedBytes.Add(size) <= maxQueuedBytes {
		select {
		case p.send <- b:
			return
		default:
		}
	}
	p.queuedBytes.Add(-size)
	p.overflow = true
	p.close()
}

func (p *Peer) member() protocol.Member {
	return protocol.Member{ID: p.memberID, Nick: p.nick, Trip: p.trip, Active: p.active, Color: p.color}
}

var nickOK = regexp.MustCompile(`^[\pL\pN_-]{1,16}$`)
var proofOK = regexp.MustCompile("^[a-f0-9]{64}$")
var colorOK = regexp.MustCompile("^(#[a-f0-9]{6})?$")

func (h *Hub) identify(p *Peer, c protocol.Command, now time.Time) bool {
	if p.trip != "" || !nickOK.MatchString(c.Nick) || !proofOK.MatchString(c.Proof) {
		return false
	}
	digest := sha256.Sum256([]byte("PulseC trip v1/" + c.Proof))
	p.trip = hex.EncodeToString(digest[:8])
	p.nick = c.Nick
	if colorOK.MatchString(c.Color) {
		p.color = c.Color // an unusable colour falls back to the default
	}
	h.nextMemberID++
	p.memberID = h.nextMemberID
	p.rosterDelta = c.RosterDelta
	p.active = now.Unix()
	p.queue(protocol.Identity(p.trip))
	return true
}

func (h *Hub) rename(p *Peer, c protocol.Command) {
	if !nickOK.MatchString(c.Nick) || p.trip == "" {
		p.reject(c, protocol.InvalidNick)
		return
	}
	p.nick = c.Nick
	p.queue(protocol.Nick(p.nick))
	for n := range p.rooms {
		h.rooms[n].membership(n, "nick", p)
	}
}

// recolor sets the display colour every client shows for this connection.
// Clients derive the default from nick and trip and keep names readable.
func (h *Hub) recolor(p *Peer, c protocol.Command) {
	if p.trip == "" {
		p.reject(c, protocol.IdentityRequired)
		return
	}
	if !colorOK.MatchString(c.Color) {
		p.reject(c, protocol.InvalidColor)
		return
	}
	p.color = c.Color
	p.queue(protocol.Color(p.color))
	for n := range p.rooms {
		h.rooms[n].membership(n, "color", p)
	}
}
