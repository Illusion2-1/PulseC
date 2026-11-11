package chat

import (
	"regexp"

	"pulsec/internal/protocol"
)

var tripOK = regexp.MustCompile("^[a-f0-9]{16}$")

const (
	maxMods   = 16
	maxListed = 256
	maxSlow   = 5 // the global allowance is 6 per 10 s; a room may only be stricter
)

// moderate applies one administrative action from an owner or mod. Every
// change is announced to all members (targets included) before it takes effect,
// followed by a fresh snapshot so every client converges on the same policy.
func (h *Hub) moderate(p *Peer, c protocol.Command) {
	r := h.rooms[c.Room]
	if !p.rooms[c.Room] {
		p.reject(c, protocol.NotJoined)
		return
	}
	if !r.admin(p.trip) {
		p.reject(c, protocol.NotAdmin)
		return
	}
	nick := ""
	switch c.Action {
	case "kick", "ban", "unban", "mute", "unmute", "op", "deop":
		if !h.targetAllowed(p, r, c) {
			return
		}
		for u := range r.members {
			if u.trip == c.Target {
				nick = u.nick
				break
			}
		}
	default:
		c.Target = "" // Room-wide actions have no recipient to broadcast.
	}
	on, rate := c.On, 0
	switch c.Action {
	case "kick":
		on = true
	case "ban", "mute":
		list := r.banned
		if c.Action == "mute" {
			list = r.muted
		}
		if !list[c.Target] && len(list) >= maxListed {
			p.reject(c, protocol.ListFull)
			return
		}
		list[c.Target] = true
		delete(r.mods, c.Target)
		on = true
	case "unban":
		delete(r.banned, c.Target)
	case "unmute":
		delete(r.muted, c.Target)
	case "op":
		if p.trip != r.owner {
			p.reject(c, protocol.NotAdmin)
			return
		}
		if !r.mods[c.Target] && len(r.mods) >= maxMods {
			p.reject(c, protocol.ListFull)
			return
		}
		r.mods[c.Target] = true
		delete(r.banned, c.Target)
		delete(r.muted, c.Target)
		on = true
	case "deop":
		if p.trip != r.owner {
			p.reject(c, protocol.NotAdmin)
			return
		}
		delete(r.mods, c.Target)
	case "slow":
		if c.Rate < 0 || c.Rate > maxSlow {
			p.reject(c, protocol.InvalidRate)
			return
		}
		r.slow, rate = c.Rate, c.Rate
		on = rate > 0
		if !on {
			clear(r.recent)
		}
	case "lock":
		r.locked = c.On
	case "topiclock":
		r.topicLocked = c.On
	case "public":
		if c.Room == "lobby" {
			p.reject(c, protocol.InvalidTarget)
			return
		}
		r.public = c.On
	default:
		p.reject(c, protocol.UnknownAction)
		return
	}
	r.broadcast(protocol.Moderated(c.Room, c.Action, p.member(), c.Target, nick, on, rate))
	if c.Action == "kick" || c.Action == "ban" {
		for u := range r.members {
			if u.trip == c.Target {
				h.leave(u, c.Room)
			}
		}
	}
	r.broadcast(r.state(c.Room))
}

// Admins cannot act on themselves or the owner; only the owner acts on mods.
func (h *Hub) targetAllowed(p *Peer, r *channel, c protocol.Command) bool {
	if !tripOK.MatchString(c.Target) || c.Target == p.trip || c.Target == r.owner ||
		(r.mods[c.Target] && p.trip != r.owner && c.Action != "op") {
		p.reject(c, protocol.InvalidTarget)
		return false
	}
	return true
}
