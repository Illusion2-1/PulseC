package chat

import (
	"sort"
	"time"

	"pulsec/internal/protocol"
)

func (h *Hub) directory(p *Peer, c protocol.Command, now time.Time) {
	if len(c.Known) > 50 {
		p.reject(c, protocol.TooManyKnown)
		return
	}
	known := map[string]bool{}
	for _, s := range c.Known {
		known[s] = true
	}
	names := make([]string, 0)
	for n, r := range h.rooms {
		if r.public || known[n] {
			names = append(names, n)
		}
	}
	sort.Slice(names, func(i, j int) bool {
		a, b := len(h.rooms[names[i]].members), len(h.rooms[names[j]].members)
		if a == b {
			return names[i] < names[j]
		}
		return a > b
	})
	rows := []protocol.DirectoryRoom{}
	publicRows := 0
	for _, n := range names {
		r := h.rooms[n]
		if r.public {
			publicRows++
		}
		if publicRows > 50 && !known[n] {
			continue
		}
		r.advance(now.Unix())
		rows = append(rows, protocol.DirectoryRoom{Name: n, Online: len(r.members), Pulse: r.bins, Topic: r.topic, Public: r.public})
	}
	p.queue(protocol.Directory(rows, len(h.peers), int(now.Sub(h.start).Seconds())))
}
