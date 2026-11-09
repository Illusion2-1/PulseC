package protocol

import "encoding/json"

// Every event builder returns one complete frame. The caller may enqueue the
// same bytes for any number of recipients and must not modify them.
func frame(fields any) []byte {
	b, err := json.Marshal(fields)
	if err != nil {
		panic(err)
	} // all payload types are defined in this package
	return append(b, '\n')
}

type Member struct {
	ID     uint64 `json:"id"`
	Nick   string `json:"nick"`
	Trip   string `json:"trip"`
	Active int64  `json:"active"`
}

type DirectoryRoom struct {
	Name   string  `json:"name"`
	Online int     `json:"online"`
	Pulse  [30]int `json:"pulse"`
	Topic  string  `json:"topic"`
	Public bool    `json:"public"`
}

func Directory(rooms []DirectoryRoom, online, uptime int) []byte {
	return frame(map[string]any{"op": "directory", "rooms": rooms, "online": online, "uptime": uptime})
}
func Identity(trip string) []byte { return frame(map[string]string{"op": "identity", "trip": trip}) }
func Nick(nick string) []byte     { return frame(map[string]string{"op": "nick", "nick": nick}) }
func State(room, topic string, public bool, users []Member, bins [30]int) []byte {
	return frame(map[string]any{"op": "state", "room": room, "users": users, "topic": topic, "pulse": bins, "public": public})
}
func Pulse(room string, bins [30]int) []byte {
	return frame(map[string]any{"op": "pulse", "room": room, "pulse": bins})
}
func Pong(id string) []byte     { return frame(map[string]string{"op": "pong", "id": id}) }
func Ack(id, ref string) []byte { return frame(map[string]string{"op": "ack", "id": id, "ref": ref}) }
func Limited(id string, waitMS int64) []byte {
	return frame(map[string]any{"op": "limited", "id": id, "wait": max(waitMS, 1)})
}

func presenceText(action string, user Member) string {
	switch action {
	case "join":
		return "+ " + user.Nick + "#" + user.Trip
	case "leave":
		return "− " + user.Nick + "#" + user.Trip
	default:
		return ""
	}
}

func MemberChange(room, action string, user Member) []byte {
	return frame(map[string]any{"op": "member", "action": action, "room": room, "user": user, "text": presenceText(action, user)})
}

// Legacy clients receive a separate notice alongside their full roster.
func LegacyNotice(room, action string, user Member) []byte {
	text := presenceText(action, user)
	if text == "" {
		return nil
	}
	return frame(map[string]any{"op": "notice", "action": action, "room": room, "user": user, "text": text})
}

func Message(c Command, sender Member, ref string, timeMS int64, recipient string) []byte {
	return frame(struct {
		Op   string `json:"op"`
		Room string `json:"room"`
		Ref  string `json:"ref"`
		Nick string `json:"nick"`
		Trip string `json:"trip"`
		Kind string `json:"kind"`
		Text string `json:"text"`
		Time int64  `json:"time"`
		To   string `json:"to,omitempty"`
	}{"message", c.Room, ref, sender.Nick, sender.Trip, c.Kind, c.Text, timeMS, recipient})
}
