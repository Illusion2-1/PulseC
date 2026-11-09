package chat

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"pulsec/internal/protocol"
)

var idOK = regexp.MustCompile("^[a-f0-9-]{36}$")

func (h *Hub) send(p *Peer, c protocol.Command, now time.Time) {
	if !p.rooms[c.Room] {
		p.reject(c, protocol.NotJoined)
		return
	}
	if !idOK.MatchString(c.ID) {
		p.reject(c, protocol.InvalidID)
		return
	}
	key := p.trip + "/" + c.ID
	if v, ok := h.receipts[key]; ok {
		p.queue(protocol.Ack(c.ID, v.id))
		return
	}
	if strings.TrimSpace(c.Text) == "" || utf8.RuneCountInString(c.Text) > 2000 {
		p.reject(c, protocol.InvalidText)
		return
	}
	l := h.limits[p.trip]
	if l == nil {
		l = &limit{}
	}

	if wait := l.wait(now); wait > 0 {
		h.limitSend(p, c, wait)
		return
	}
	if len(h.receipts) >= maxReceipts {
		p.reject(c, protocol.ServerBusy)
		return
	}
	if !h.allowSource(p, c, now) {
		return
	}

	sum := sha256.Sum256([]byte(key))
	ref := hex.EncodeToString(sum[:6])
	room := h.rooms[c.Room]
	switch c.Kind {
	case "chat", "me":
		room.broadcast(protocol.Message(c, p.member(), ref, now.UnixMilli(), ""))
		room.advance(now.Unix())
		room.bins[29]++
	case "topic":
		if !h.setTopic(p, room, c, now) {
			return
		}
	case "whisper":
		if !room.whisper(p, c, ref, now) {
			return
		}
	default:
		p.reject(c, protocol.UnknownKind)
		return
	}
	h.receipts[key] = receipt{now, ref}
	h.limits[p.trip] = l
	l.sent = append(l.sent, now)
	p.active = now.Unix()
	p.queue(protocol.Ack(c.ID, ref))
}

func (h *Hub) setTopic(p *Peer, r *channel, c protocol.Command, now time.Time) bool {
	if utf8.RuneCountInString(c.Text) > 120 {
		p.reject(c, protocol.TopicTooLong)
		return false
	}
	if now.Sub(r.topicChanged) < 10*time.Second {
		h.limited++
		p.reject(c, protocol.TopicLimited)
		return false
	}
	r.topicChanged = now
	r.topic = c.Text
	r.broadcast(r.state(c.Room))
	return true
}

func (r *channel) whisper(p *Peer, c protocol.Command, ref string, now time.Time) bool {
	var target *Peer
	for u := range r.members {
		if u.nick == c.To || u.nick+"#"+u.trip == c.To {
			if target != nil {
				p.reject(c, protocol.AmbiguousRecipient)
				return false
			}
			target = u
		}
	}
	if target == nil {
		p.reject(c, protocol.RecipientOffline)
		return false
	}
	msg := protocol.Message(c, p.member(), ref, now.UnixMilli(), target.nick+"#"+target.trip)
	target.queue(msg)
	if target != p {
		p.queue(msg)
	}
	return true
}
