package protocol

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

// These are the fields consumed by existing clients, including the legacy
// fallback text. Compare JSON values so object field order stays irrelevant.
func TestV1DeliveryFrames(t *testing.T) {
	sender := Member{ID: 7, Nick: "Al", Trip: "0123", Active: 42}
	c := Command{Room: "lobby", Kind: "chat", Text: "one\ntwo"}
	const chatJSON = `{"op":"message","room":"lobby","ref":"ab","nick":"Al","trip":"0123","kind":"chat","text":"one\ntwo","time":42}`
	public := Message(c, sender, "ab", 42, "")
	c.Kind = "whisper"
	tests := []struct {
		name string
		wire []byte
		want string
	}{
		{"public", public, chatJSON},
		{"whisper", Message(c, sender, "cd", 43, "Bo#abcd"), `{"op":"message","room":"lobby","ref":"cd","nick":"Al","trip":"0123","kind":"whisper","text":"one\ntwo","time":43,"to":"Bo#abcd"}`},
		{"join delta", MemberChange("lobby", "join", sender), `{"op":"member","room":"lobby","action":"join","text":"+ Al#0123","user":{"id":7,"nick":"Al","trip":"0123","active":42}}`},
		{"legacy leave", LegacyNotice("lobby", "leave", sender), `{"op":"notice","room":"lobby","action":"leave","text":"− Al#0123","user":{"id":7,"nick":"Al","trip":"0123","active":42}}`},
		{"empty directory", Directory([]DirectoryRoom{}, 0, 1), `{"op":"directory","rooms":[],"online":0,"uptime":1}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if !bytes.HasSuffix(tc.wire, []byte{'\n'}) || bytes.Count(tc.wire, []byte{'\n'}) != 1 {
				t.Fatalf("expected a single newline-terminated frame: %q", tc.wire)
			}
			var got, want map[string]any
			if err := json.Unmarshal(tc.wire, &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(tc.want), &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %s, want %s", tc.wire, tc.want)
			}
		})
	}
}
