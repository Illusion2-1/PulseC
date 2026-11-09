package chat

import (
	"crypto/sha256"
	"encoding/hex"
	"net/netip"
	"regexp"
	"time"

	"pulsec/internal/protocol"
	"pulsec/internal/ratelimit"
)

type Peer struct {
	source        netip.Addr
	controlBudget ratelimit.Bucket
	nick, trip    string
	memberID      uint64
	rosterDelta   bool
	rooms         map[string]bool
	send          chan []byte
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

// Outbound frames may be shared by multiple peers and must only be read.
func (p *Peer) Outbound() <-chan []byte { return p.send }

func (p *Peer) Done() <-chan struct{} { return p.stop }

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

func (p *Peer) queue(b []byte) {
	select {
	case p.send <- b:
	default:
		p.overflow = true
		p.close()
	}
}

func (p *Peer) member() protocol.Member {
	return protocol.Member{ID: p.memberID, Nick: p.nick, Trip: p.trip, Active: p.active}
}

var nickOK = regexp.MustCompile(`^[\pL\pN_-]{1,16}$`)
var proofOK = regexp.MustCompile("^[a-f0-9]{64}$")

func (h *Hub) identify(p *Peer, c protocol.Command, now time.Time) bool {
	if p.trip != "" || !nickOK.MatchString(c.Nick) || !proofOK.MatchString(c.Proof) {
		return false
	}
	digest := sha256.Sum256([]byte("PulseC trip v1/" + c.Proof))
	p.trip = hex.EncodeToString(digest[:8])
	p.nick = c.Nick
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
