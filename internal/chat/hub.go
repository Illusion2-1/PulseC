// Package chat owns ephemeral room membership, message delivery and rate limits.
package chat

import (
	"net/netip"
	"sync"
	"time"

	"pulsec/internal/protocol"
	"pulsec/internal/ratelimit"
)

type Hub struct {
	sourceRate   int
	sources      map[netip.Addr]*ratelimit.Bucket
	mu           sync.Mutex
	rooms        map[string]*channel
	receipts     map[string]receipt
	limits       map[string]*limit
	start        time.Time
	peers        map[*Peer]bool
	nextMemberID uint64
	limited      uint64
}

// NewHub creates the relay state for one process. sourceRate is the validated
// number of sends per second allowed from an address.
func NewHub(sourceRate int) *Hub {
	return &Hub{
		start:      time.Now(),
		sourceRate: sourceRate,
		sources:    make(map[netip.Addr]*ratelimit.Bucket),
		rooms:      make(map[string]*channel),
		receipts:   make(map[string]receipt),
		limits:     make(map[string]*limit),
		peers:      make(map[*Peer]bool),
	}
}

func (h *Hub) Started() time.Time { return h.start }

type Stats struct {
	Online, Rooms, Receipts, LimitTrips, LimitSources int
	Limited                                           uint64
}

func (h *Hub) Stats() Stats {
	h.mu.Lock()
	defer h.mu.Unlock()
	return Stats{
		Online:       len(h.peers),
		Rooms:        len(h.rooms),
		Receipts:     len(h.receipts),
		LimitTrips:   len(h.limits),
		LimitSources: len(h.sources),
		Limited:      h.limited,
	}
}

// Remove detaches the Peer and reports whether its outbound queue overflowed.
func (h *Hub) Remove(p *Peer) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	p.close()
	for name := range p.rooms {
		h.leave(p, name)
	}
	return p.overflow
}

// Handle applies one command. False tells the owner to disconnect the Peer.
// All command handlers below run under the same lock and never write to a socket.
func (h *Hub) Handle(p *Peer, c protocol.Command) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := time.Now()
	if !p.allowRequest(now) {
		return false
	}
	switch c.Op {
	case "directory", "join", "leave", "nick", "ping", "color", "moderate":
		if !p.controlBudget.Take(now, 500*time.Millisecond, 24) {
			h.limited++
			p.reject(c, protocol.ControlLimited)
			return true
		}
	}
	switch c.Op {
	case "identity":
		return h.identify(p, c, now)
	case "directory":
		h.directory(p, c, now)
	case "join":
		h.join(p, c)
	case "leave":
		h.leave(p, c.Room)
	case "nick":
		h.rename(p, c)
	case "ping":
		h.ping(p, c.ID, now)
	case "send":
		h.send(p, c, now)
	case "color":
		h.recolor(p, c)
	case "moderate":
		h.moderate(p, c)
	default:
		p.reject(c, protocol.UnknownOp)
	}
	return true
}
