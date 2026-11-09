package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type command struct {
	Op, Room, Nick, Proof, Kind, To, Text, ID string
	Public, RosterDelta                       bool
	Known                                     []string
}
type event map[string]any
type peer struct {
	nick, trip  string
	memberID    uint64
	rosterDelta bool
	rooms       map[string]bool
	send        chan []byte
	stop        chan struct{}
	stopped     bool
	second      int64
	requests    int
	active      int64
}
type channel struct {
	members map[*peer]bool
	public  bool
	topic   string
	bins    [30]int
	minute  int64
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
	sync.Mutex
	rooms        map[string]*channel
	receipts     map[string]receipt
	limits       map[string]*limit
	start        time.Time
	peers        map[*peer]bool
	nextMemberID uint64
}

func newHub() *hub {
	h := &hub{rooms: map[string]*channel{}, receipts: map[string]receipt{}, limits: map[string]*limit{}, start: time.Now(), peers: map[*peer]bool{}}
	go func() {
		for now := range time.Tick(time.Minute) {
			h.Lock()
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
			h.Unlock()
		}
	}()
	return h
}
func (p *peer) close() {
	if !p.stopped {
		close(p.stop)
		p.stopped = true
	}
}
func pack(e event) []byte {
	b, err := json.Marshal(e)
	if err != nil {
		panic(err)
	}
	return append(b, '\n')
}
func (p *peer) queue(b []byte) {
	select {
	case p.send <- b:
	default:
		p.close()
	}
}
func (p *peer) emit(e event) { p.queue(pack(e)) }
func (r *channel) broadcast(e event) {
	b := pack(e)
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
func (p *peer) member() event {
	return event{"id": p.memberID, "nick": p.nick, "trip": p.trip, "active": p.active}
}

// A new subscriber gets one complete roster. Older clients still receive snapshots;
// clients advertising delta support apply changes in order on the same reliable stream.
func (r *channel) membership(room, action, text string, member *peer) {
	change := pack(event{"op": "member", "room": room, "action": action, "user": member.member(), "text": text})
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
			snapshot = pack(r.state(room))
			if text != "" {
				notice = pack(event{"op": "notice", "room": room, "text": text})
			}
		}
		if notice != nil {
			p.queue(notice)
		}
		p.queue(snapshot)
	}
}
func (r *channel) state(name string) event {
	r.advance(time.Now().Unix())
	users := make([]event, 0, len(r.members))
	for p := range r.members {
		users = append(users, p.member())
	}
	return event{"op": "state", "room": name, "users": users, "pulse": r.bins, "topic": r.topic, "public": r.public}
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
		r.membership(name, "leave", "− "+p.nick+"#"+p.trip, p)
	}
}

var nickOK = regexp.MustCompile("^[\\pL\\pN_-]{1,16}$")
var roomOK = regexp.MustCompile("^[\\pL\\pN_-]{1,24}$")
var proofOK = regexp.MustCompile("^[a-f0-9]{64}$")
var idOK = regexp.MustCompile("^[a-f0-9-]{36}$")

func (h *hub) handle(p *peer, c command) bool {
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
	fail := func(msg string) {
		p.emit(event{"op": "error", "id": c.ID, "room": c.Room, "text": msg, "request": c.Op})
	}
	r := h.rooms[c.Room]
	switch c.Op {
	case "directory":
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
		rows := []event{}
		for _, n := range names {
			r := h.rooms[n]
			if len(rows) >= 50 && !known[n] {
				continue
			}
			r.advance(now.Unix())
			rows = append(rows, event{"name": n, "online": len(r.members), "pulse": r.bins, "topic": r.topic, "public": r.public})
		}
		p.emit(event{"op": "directory", "rooms": rows, "online": len(h.peers), "uptime": int(time.Since(h.start).Seconds())})
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
		p.emit(event{"op": "identity", "trip": p.trip})
	case "join":
		if p.trip == "" || !roomOK.MatchString(c.Room) || len(p.rooms) >= 9 {
			fail("频道名无效或已达到 9 个频道上限")
			break
		}
		if r == nil {
			r = &channel{members: map[*peer]bool{}, public: c.Public || c.Room == "lobby"}
			h.rooms[c.Room] = r
		}
		if !p.rooms[c.Room] {
			r.members[p] = true
			p.rooms[c.Room] = true
			h.peers[p] = true
			r.membership(c.Room, "join", "+ "+p.nick+"#"+p.trip, p)
		}
		p.emit(r.state(c.Room))
	case "leave":
		if p.rooms[c.Room] {
			h.leave(p, c.Room)
			if len(p.rooms) == 0 {
				delete(h.peers, p)
			}
		}
	case "ping":
		p.emit(event{"op": "pong", "id": c.ID})
		for n := range p.rooms {
			r := h.rooms[n]
			r.advance(now.Unix())
			p.emit(event{"op": "pulse", "room": n, "pulse": r.bins})
		}
	case "nick":
		if !nickOK.MatchString(c.Nick) || p.trip == "" {
			fail("昵称无效")
			break
		}
		p.nick = c.Nick
		p.emit(event{"op": "nick", "nick": p.nick})
		for n := range p.rooms {
			h.rooms[n].membership(n, "nick", "", p)
		}
	case "send":
		if !p.rooms[c.Room] || !idOK.MatchString(c.ID) {
			fail("尚未加入频道或消息编号无效")
			break
		}
		key := p.trip + "/" + c.ID
		if v, ok := h.receipts[key]; ok {
			p.emit(event{"op": "ack", "id": c.ID, "ref": v.id})
			break
		}
		if strings.TrimSpace(c.Text) == "" || utf8.RuneCountInString(c.Text) > 2000 {
			fail("消息需要 1–2000 个字符")
			break
		}
		l := h.limits[p.trip]
		if l == nil {
			l = &limit{}
			h.limits[p.trip] = l
		}
		for len(l.sent) > 0 && now.Sub(l.sent[0]) >= 10*time.Second {
			l.sent = l.sent[1:]
		}
		if now.Before(l.until) || len(l.sent) >= 6 {
			if !now.Before(l.until) {
				l.until = now.Add(4 * time.Second)
			}
			p.emit(event{"op": "limited", "id": c.ID, "wait": max(time.Until(l.until).Milliseconds(), 1)})
			break
		}
		sum := sha256.Sum256([]byte(key))
		ref := hex.EncodeToString(sum[:6])
		msg := event{"op": "message", "room": c.Room, "ref": ref, "nick": p.nick, "trip": p.trip, "kind": c.Kind, "text": c.Text, "time": now.UnixMilli()}
		switch c.Kind {
		case "chat", "me":
			r.broadcast(msg)
			r.advance(now.Unix())
			r.bins[29]++
		case "topic":
			if utf8.RuneCountInString(c.Text) > 120 {
				fail("主题最长 120 字")
				return true
			}
			r.topic = c.Text
			r.broadcast(r.state(c.Room))
		case "whisper":
			var target *peer
			for u := range r.members {
				if u.nick == c.To || u.nick+"#"+u.trip == c.To {
					if target != nil {
						fail("收件人有重名，请指定 昵称#完整trip")
						return true
					}
					target = u
				}
			}
			if target == nil {
				fail("收件人不在线")
				return true
			}
			msg["to"] = target.nick + "#" + target.trip
			target.emit(msg)
			if target != p {
				p.emit(msg)
			}
		default:
			fail("未知消息类型")
			return true
		}
		h.receipts[key] = receipt{now, ref}
		l.sent = append(l.sent, now)
		p.active = now.Unix()
		p.emit(event{"op": "ack", "id": c.ID, "ref": ref})
	default:
		fail("未知操作")
	}
	return true
}
