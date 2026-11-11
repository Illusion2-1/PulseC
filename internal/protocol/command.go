// Package protocol implements the PulseC v1 stream representation.
package protocol

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

// Command is the input to the chat layer after decoding a frame.
type Command struct {
	Op          string     `json:"op"`
	Room        string     `json:"room"`
	Nick        string     `json:"nick"`
	Proof       string     `json:"proof"`
	Kind        string     `json:"kind"`
	To          string     `json:"to"`
	Text        string     `json:"text"`
	ID          string     `json:"id"`
	Public      bool       `json:"public"`
	RosterDelta bool       `json:"rosterDelta"`
	Known       knownRooms `json:"known"`
	// identity / color: "#rrggbb" or empty for the default derived colour.
	Color string `json:"color"`
	// moderate: action, target trip, switch and per-trip rate in 10 s.
	Action string `json:"action"`
	Target string `json:"target"`
	On     bool   `json:"on"`
	Rate   int    `json:"rate"`
}

const MaxFrameSize = 32 << 10
const MaxKnownRooms = 50

var ErrInvalidCommand = errors.New("invalid command")

type knownRooms []string

func (rooms *knownRooms) UnmarshalJSON(data []byte) error {
	*rooms = (*rooms)[:0]
	if bytes.Equal(data, []byte("null")) {
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	if token, err := decoder.Token(); err != nil || token != json.Delim('[') {
		return ErrInvalidCommand
	}
	// The outer decoder validates the entire JSON frame. Keep one extra
	// entry so the hub can return the existing too_many_known response.
	for len(*rooms) <= MaxKnownRooms && decoder.More() {
		var name string
		if err := decoder.Decode(&name); err != nil {
			return err
		}
		*rooms = append(*rooms, name)
	}
	return nil
}

func Decode(raw []byte) (Command, error) {
	var c Command
	if len(raw) >= MaxFrameSize || !utf8.Valid(raw) || json.Unmarshal(raw, &c) != nil {
		return Command{}, ErrInvalidCommand
	}
	// These fields can be echoed even when a command is rejected.
	if c.Op == "" || len(c.Op) > 32 || len(c.Room) > 24*utf8.UTFMax || len(c.ID) > 64 {
		return Command{}, ErrInvalidCommand
	}
	return c, nil
}

type Reader struct{ lines *bufio.Scanner }

func NewReader(r io.Reader) *Reader {
	lines := bufio.NewScanner(r)
	lines.Buffer(make([]byte, 2048), MaxFrameSize)
	lines.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		advance, token, err := bufio.ScanLines(data, false)
		if atEOF && len(data) != 0 && advance == 0 {
			return 0, nil, ErrInvalidCommand
		}
		return advance, token, err
	})
	return &Reader{lines: lines}
}

func (r *Reader) ReadCommand() (Command, error) {
	if r.lines.Scan() {
		return Decode(r.lines.Bytes())
	}
	if err := r.lines.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) {
			return Command{}, ErrInvalidCommand
		}
		return Command{}, err
	}
	return Command{}, io.EOF
}
