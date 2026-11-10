// Package protocol implements the PulseC v1 stream representation.
package protocol

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

// Command is the input to the chat layer after decoding a frame.
type Command struct {
	Op          string   `json:"op"`
	Room        string   `json:"room"`
	Nick        string   `json:"nick"`
	Proof       string   `json:"proof"`
	Kind        string   `json:"kind"`
	To          string   `json:"to"`
	Text        string   `json:"text"`
	ID          string   `json:"id"`
	Public      bool     `json:"public"`
	RosterDelta bool     `json:"rosterDelta"`
	Known       []string `json:"known"`
	// identity / color: "#rrggbb" or empty for the default derived colour.
	Color string `json:"color"`
	// moderate: action, target trip, switch and per-trip rate in 10 s.
	Action string `json:"action"`
	Target string `json:"target"`
	On     bool   `json:"on"`
	Rate   int    `json:"rate"`
}

const MaxFrameSize = 32 << 10

var ErrInvalidCommand = errors.New("invalid command")

func Decode(raw []byte) (Command, error) {
	var c Command
	if len(raw) >= MaxFrameSize || !utf8.Valid(raw) || json.Unmarshal(raw, &c) != nil {
		return Command{}, ErrInvalidCommand
	}
	return c, nil
}

type Reader struct{ lines *bufio.Scanner }

func NewReader(r io.Reader) *Reader {
	lines := bufio.NewScanner(r)
	lines.Buffer(make([]byte, 2048), MaxFrameSize)
	return &Reader{lines: lines}
}

func (r *Reader) ReadCommand() (Command, error) {
	if r.lines.Scan() {
		return Decode(r.lines.Bytes())
	}
	if err := r.lines.Err(); err != nil {
		return Command{}, err
	}
	return Command{}, io.EOF
}
