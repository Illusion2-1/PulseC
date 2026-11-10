package chat

import (
	"time"

	"pulsec/internal/protocol"
	"pulsec/internal/ratelimit"
)

type receipt struct {
	when time.Time
	id   string
}
type limit struct {
	sent  []time.Time
	until time.Time
}

// Sweep expired metadata; the process owns the ticker (tests need no background worker).
func (h *Hub) Sweep(now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for addr, b := range h.sources {
		if now.Sub(b.Next()) > time.Minute {
			delete(h.sources, addr)
		}
	}
	for k, v := range h.receipts {
		if now.Sub(v.when) > 5*time.Minute {
			delete(h.receipts, k)
		}
	}
	for _, r := range h.rooms {
		for trip, sent := range r.recent {
			if len(sent) == 0 || now.Sub(sent[len(sent)-1]) >= 10*time.Second {
				delete(r.recent, trip)
			}
		}
	}
	for k, v := range h.limits {
		if len(v.sent) == 0 || now.Sub(v.sent[len(v.sent)-1]) > time.Minute {
			delete(h.limits, k)
		}
	}
}

const maxReceipts = 65536

// Only successful sends enter the trip's sliding window. Retries and failed
// validation retain the caller's original allowance.
func (l *limit) wait(now time.Time) time.Duration {
	for len(l.sent) > 0 && now.Sub(l.sent[0]) >= 10*time.Second {
		l.sent = l.sent[1:]
	}
	if !now.Before(l.until) && len(l.sent) >= 6 {
		l.until = l.sent[0].Add(10 * time.Second)
		if floor := now.Add(4 * time.Second); l.until.Before(floor) {
			l.until = floor
		}
	}
	return l.until.Sub(now)
}

func (h *Hub) limitSend(p *Peer, c protocol.Command, wait time.Duration) {
	h.limited++
	p.queue(protocol.Limited(c.ID, wait.Milliseconds()))
}

func (h *Hub) allowSource(p *Peer, c protocol.Command, now time.Time) bool {
	if !p.source.IsValid() {
		return true
	}
	b := h.sources[p.source]
	if b == nil {
		if len(h.sources) >= maxReceipts {
			p.reject(c, protocol.ServerBusy)
			return false
		}
		b = &ratelimit.Bucket{}
		h.sources[p.source] = b
	}
	if !b.Take(now, time.Second/time.Duration(h.sourceRate), 2*h.sourceRate) {
		h.limitSend(p, c, b.Next().Sub(now))
		return false
	}
	return true
}
