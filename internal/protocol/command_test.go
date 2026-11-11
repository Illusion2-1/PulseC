package protocol

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestReadCommandsAcrossFrames(t *testing.T) {
	lines := bytes.NewBufferString("{\"op\":\"send\",\"text\":\"line one\\nline two\",\"newField\":true}\r\n{\"op\":\"identity\",\"rosterDelta\":true}\n")
	r := NewReader(lines)
	c, err := r.ReadCommand()
	if err != nil || c.Op != "send" || c.Text != "line one\nline two" {
		t.Fatal(c, err)
	}
	c, err = r.ReadCommand()
	if err != nil || c.Op != "identity" || !c.RosterDelta {
		t.Fatal(c, err)
	}
	if _, err := r.ReadCommand(); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
}

func TestInvalidFrameBoundaries(t *testing.T) {
	for _, input := range []string{
		`{"op":"ping"}`, "null\n", "{}\n",
		strings.Repeat(" ", MaxFrameSize) + "\n",
		`{"op":"ping","id":"` + strings.Repeat("x", 65) + `"}` + "\n",
	} {
		if _, err := NewReader(strings.NewReader(input)).ReadCommand(); !errors.Is(err, ErrInvalidCommand) {
			t.Fatalf("expected a protocol error for %d bytes, got %v", len(input), err)
		}
	}
}

func TestDirectoryDecoderRetainsOnlyEnoughNamesToReject(t *testing.T) {
	raw := `{"op":"directory","known":[` + strings.Repeat(`"room",`, 100) + `"last"]}`
	c, err := Decode([]byte(raw))
	if err != nil || len(c.Known) != MaxKnownRooms+1 {
		t.Fatalf("retained %d names: %v", len(c.Known), err)
	}
}
