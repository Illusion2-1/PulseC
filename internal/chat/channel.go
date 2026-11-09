package chat

import (
	"regexp"
	"time"

	"pulsec/internal/protocol"
)

type channel struct {
	topicChanged time.Time
	members      map[*Peer]bool
	public       bool
	topic        string
	bins         [30]int
	minute       int64
}

func (r *channel) broadcast(b []byte) {
	for p := range r.members {
		p.queue(b)
	}
}

func (r *channel) advance(now int64) {
	m := now / 60
	d := min(m-r.minute, 30)
	if d > 0 {
		copy(r.bins[:], r.bins[d:])
		clear(r.bins[30-d:])
		r.minute = m
	}
}

// A new subscriber gets one complete roster. Older clients still receive snapshots;
// clients advertising delta support apply changes in order on the same reliable stream.
func (r *channel) membership(room, action string, member *Peer) {
	user := member.member()
	change := protocol.MemberChange(room, action, user)
	var snapshot, notice []byte
	for p := range r.members {
		if action == "join" && p == member {
			continue
		}
		if p.rosterDelta {
			p.queue(change)
			continue
		}
		if snapshot == nil {
			snapshot = r.state(room)
			notice = protocol.LegacyNotice(room, action, user)
		}
		if notice != nil {
			p.queue(notice)
		}
		p.queue(snapshot)
	}
}

func (r *channel) state(name string) []byte {
	r.advance(time.Now().Unix())
	users := make([]protocol.Member, 0, len(r.members))
	for p := range r.members {
		users = append(users, p.member())
	}
	return protocol.State(name, r.topic, r.public, users, r.bins)
}

const maxRooms = 1024

var roomOK = regexp.MustCompile(`^[\pL\pN_-]{1,24}$`)

func (h *Hub) join(p *Peer, c protocol.Command) {
	r := h.rooms[c.Room]
	if p.trip == "" {
		p.reject(c, protocol.IdentityRequired)
		return
	}
	if !roomOK.MatchString(c.Room) {
		p.reject(c, protocol.InvalidRoom)
		return
	}
	if !p.rooms[c.Room] && len(p.rooms) >= 9 {
		p.reject(c, protocol.RoomLimit)
		return
	}
	if r == nil {
		if len(h.rooms) >= maxRooms {
			p.reject(c, protocol.RoomCapacity)
			return
		}
		r = &channel{members: map[*Peer]bool{}, public: c.Public || c.Room == "lobby"}
		h.rooms[c.Room] = r
	}
	if !p.rooms[c.Room] {
		r.members[p] = true
		p.rooms[c.Room] = true
		h.peers[p] = true
		r.membership(c.Room, "join", p)
	}
	p.queue(r.state(c.Room))
}

func (h *Hub) leave(p *Peer, name string) {
	if !p.rooms[name] {
		return
	}
	r := h.rooms[name]
	delete(p.rooms, name)
	if len(p.rooms) == 0 {
		delete(h.peers, p)
	}
	delete(r.members, p)
	if len(r.members) == 0 {
		delete(h.rooms, name)
	} else {
		r.membership(name, "leave", p)
	}
}

func (h *Hub) ping(p *Peer, id string, now time.Time) {
	p.queue(protocol.Pong(id))
	for n := range p.rooms {
		r := h.rooms[n]
		r.advance(now.Unix())
		p.queue(protocol.Pulse(n, r.bins))
	}
}
