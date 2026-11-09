package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/netip"
	"pulsec/internal/protocol"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type peer struct {
	source        netip.Addr
	controlBudget timeBudget
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
type channel struct {
	topicChanged time.Time
	members      map[*peer]bool
	public       bool
	topic        string
	bins         [30]int
	minute       int64
}
type receipt struct {
	when time.Time
	id   string
}
type limit struct {
	sent  []time.Time
	until time.Time
}
type hub struct {
	sourceRate int
	sources    map[netip.Addr]*timeBudget
	sync.Mutex
	rooms        map[string]*channel
	receipts     map[string]receipt
	limits       map[string]*limit
	start        time.Time
	peers        map[*peer]bool
	nextMemberID uint64
	limited      uint64
}

func newHub() *hub {
	return &hub{sourceRate: 128, sources: map[netip.Addr]*timeBudget{}, rooms: map[string]*channel{}, receipts: map[string]receipt{}, limits: map[string]*limit{}, start: time.Now(), peers: map[*peer]bool{}}
}

// Sweep expired metadata; the process owns the ticker (tests need no background worker).
func (h *hub) sweep(now time.Time) {
	h.Lock()
	defer h.Unlock()
	for addr, b := range h.sources {
		if now.Sub(b.next) > time.Minute {
			delete(h.sources, addr)
		}
	}
	for k, v := range h.receipts {
		if now.Sub(v.when) > 5*time.Minute {
			delete(h.receipts, k)
		}
	}
	for k, v := range h.limits {
		if len(v.sent) == 0 || now.Sub(v.sent[len(v.sent)-1]) > time.Minute {
			delete(h.limits, k)
		}
	}
}

const (
	maxRooms    = 1024
	maxReceipts = 65536
)

// Track a burst without storing a timestamp per request.
type timeBudget struct{ next time.Time }

func (b *timeBudget) take(now time.Time, interval time.Duration, burst int) bool {
	floor := now.Add(-time.Duration(burst-1) * interval)
	if b.next.Before(floor) {
		b.next = floor
	}
	if b.next.After(now) {
		return false
	}
	b.next = b.next.Add(interval)
	return true
}

func (p *peer) close() {
	if !p.stopped {
		close(p.stop)
		p.stopped = true
	}
}
func (p *peer) queue(b []byte) {
	select {
	case p.send <- b:
	default:
		p.overflow = true
		p.close()
	}
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
func (p *peer) member() protocol.Member {
	return protocol.Member{ID: p.memberID, Nick: p.nick, Trip: p.trip, Active: p.active}
}

// A new subscriber gets one complete roster. Older clients still receive snapshots;
// clients advertising delta support apply changes in order on the same reliable stream.
func (r *channel) membership(room, action string, member *peer) {
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
func (h *hub) remove(p *peer) {
	h.Lock()
	defer h.Unlock()
	p.close()
	delete(h.peers, p)
	for name := range p.rooms {
		h.leave(p, name)
	}
}
func (h *hub) leave(p *peer, name string) {
	r := h.rooms[name]
	delete(p.rooms, name)
	delete(r.members, p)
	if len(r.members) == 0 {
		delete(h.rooms, name)
	} else {
		r.membership(name, "leave", p)
	}
}

var nickOK = regexp.MustCompile(`^[\pL\pN_-]{1,16}$`)
var roomOK = regexp.MustCompile(`^[\pL\pN_-]{1,24}$`)
var proofOK = regexp.MustCompile("^[a-f0-9]{64}$")
var idOK = regexp.MustCompile("^[a-f0-9-]{36}$")

func (h *hub) handle(p *peer, c protocol.Command) bool {
	h.Lock()
	defer h.Unlock()
	now := time.Now()
	if p.second != now.Unix() {
		p.second = now.Unix()
		p.requests = 0
	}
	p.requests++
	if p.stopped || p.requests > 60 {
		return false
	}
	fail := func(problem protocol.Problem) { p.queue(protocol.Reject(c, problem)) }
	switch c.Op {
	case "directory", "join", "leave", "nick", "ping":
		if !p.controlBudget.take(now, 500*time.Millisecond, 24) {
			h.limited++
			fail(protocol.ControlLimited)
			return true
		}
	}
	r := h.rooms[c.Room]
	switch c.Op {
	case "directory":
		if len(c.Known) > 50 {
			fail(protocol.TooManyKnown)
			break
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
		p.queue(protocol.Directory(rows, len(h.peers), int(time.Since(h.start).Seconds())))
	case "identity":
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
	case "join":
		if p.trip == "" {
			fail(protocol.IdentityRequired)
			break
		}
		if !roomOK.MatchString(c.Room) {
			fail(protocol.InvalidRoom)
			break
		}
		if !p.rooms[c.Room] && len(p.rooms) >= 9 {
			fail(protocol.RoomLimit)
			break
		}
		if r == nil {
			if len(h.rooms) >= maxRooms {
				fail(protocol.RoomCapacity)
				break
			}
			r = &channel{members: map[*peer]bool{}, public: c.Public || c.Room == "lobby"}
			h.rooms[c.Room] = r
		}
		if !p.rooms[c.Room] {
			r.members[p] = true
			p.rooms[c.Room] = true
			h.peers[p] = true
			r.membership(c.Room, "join", p)
		}
		p.queue(r.state(c.Room))
	case "leave":
		if p.rooms[c.Room] {
			h.leave(p, c.Room)
			if len(p.rooms) == 0 {
				delete(h.peers, p)
			}
		}
	case "ping":
		p.queue(protocol.Pong(c.ID))
		for n := range p.rooms {
			r := h.rooms[n]
			r.advance(now.Unix())
			p.queue(protocol.Pulse(n, r.bins))
		}
	case "nick":
		if !nickOK.MatchString(c.Nick) || p.trip == "" {
			fail(protocol.InvalidNick)
			break
		}
		p.nick = c.Nick
		p.queue(protocol.Nick(p.nick))
		for n := range p.rooms {
			h.rooms[n].membership(n, "nick", p)
		}
	case "send":
		if !p.rooms[c.Room] {
			fail(protocol.NotJoined)
			break
		}
		if !idOK.MatchString(c.ID) {
			fail(protocol.InvalidID)
			break
		}
		key := p.trip + "/" + c.ID
		if v, ok := h.receipts[key]; ok {
			p.queue(protocol.Ack(c.ID, v.id))
			break
		}
		if strings.TrimSpace(c.Text) == "" || utf8.RuneCountInString(c.Text) > 2000 {
			fail(protocol.InvalidText)
			break
		}
		l := h.limits[p.trip]
		if l == nil {
			l = &limit{}
		}
		for len(l.sent) > 0 && now.Sub(l.sent[0]) >= 10*time.Second {
			l.sent = l.sent[1:]
		}
		if now.Before(l.until) || len(l.sent) >= 6 {
			if !now.Before(l.until) {
				l.until = l.sent[0].Add(10 * time.Second)
				if floor := now.Add(4 * time.Second); l.until.Before(floor) {
					l.until = floor
				}
			}
			h.limited++
			p.queue(protocol.Limited(c.ID, time.Until(l.until).Milliseconds()))
			break
		}
		if len(h.receipts) >= maxReceipts {
			fail(protocol.ServerBusy)
			break
		}
		// The sender address comes only from QUIC. Never trust forwarding headers.
		if p.source.IsValid() {
			b := h.sources[p.source]
			if b == nil {
				if len(h.sources) >= maxReceipts {
					fail(protocol.ServerBusy)
					break
				}
				b = &timeBudget{}
				h.sources[p.source] = b
			}
			if !b.take(now, time.Second/time.Duration(h.sourceRate), 2*h.sourceRate) {
				h.limited++
				p.queue(protocol.Limited(c.ID, b.next.Sub(now).Milliseconds()))
				break
			}
		}
		sum := sha256.Sum256([]byte(key))
		ref := hex.EncodeToString(sum[:6])
		switch c.Kind {
		case "chat", "me":
			r.broadcast(protocol.Message(c, p.member(), ref, now.UnixMilli(), ""))
			r.advance(now.Unix())
			r.bins[29]++
		case "topic":
			if utf8.RuneCountInString(c.Text) > 120 {
				fail(protocol.TopicTooLong)
				return true
			}
			if now.Sub(r.topicChanged) < 10*time.Second {
				h.limited++
				fail(protocol.TopicLimited)
				return true
			}
			r.topicChanged = now
			r.topic = c.Text
			r.broadcast(r.state(c.Room))
		case "whisper":
			var target *peer
			for u := range r.members {
				if u.nick == c.To || u.nick+"#"+u.trip == c.To {
					if target != nil {
						fail(protocol.AmbiguousRecipient)
						return true
					}
					target = u
				}
			}
			if target == nil {
				fail(protocol.RecipientOffline)
				return true
			}
			msg := protocol.Message(c, p.member(), ref, now.UnixMilli(), target.nick+"#"+target.trip)
			target.queue(msg)
			if target != p {
				p.queue(msg)
			}
		default:
			fail(protocol.UnknownKind)
			return true
		}
		h.receipts[key] = receipt{now, ref}
		h.limits[p.trip] = l
		l.sent = append(l.sent, now)
		p.active = now.Unix()
		p.queue(protocol.Ack(c.ID, ref))
	default:
		fail(protocol.UnknownOp)
	}
	return true
}
