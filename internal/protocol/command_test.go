package protocol

import (
	"bytes"
	"errors"
	"io"
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
