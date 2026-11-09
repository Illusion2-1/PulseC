package server

import (
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDirectModeRequiresExplicitOptions(t *testing.T) {
	base := Config{HTTPAddr: ":80", PublicHost: "chat.example.test", ACMEWebroot: "webroot", CertFile: "cert", KeyFile: "key"}
	if direct, err := base.directMode(); err != nil || !direct {
		t.Fatal(direct, err)
	}
	plain := Config{Addr: ":8443", CertFile: "cert", KeyFile: "key"}
	if direct, err := plain.directMode(); err != nil || direct {
		t.Fatal(direct, err)
	}
	for _, key := range []string{"address", "domain", "webroot", "cert", "key"} {
		cfg := base
		switch key {
		case "address":
			cfg.HTTPAddr = ""
		case "domain":
			cfg.PublicHost = ""
		case "webroot":
			cfg.ACMEWebroot = ""
		case "cert":
			cfg.CertFile = ""
		case "key":
			cfg.KeyFile = ""
		}
		if _, err := cfg.directMode(); err == nil {
			t.Errorf("direct operation without %s", key)
		}
	}
	for _, name := range []string{"https://example.test", "example.test:8443", "user@example.test", "127.0.0.1", "[::1]", "chat..test", "-chat.test", "example.test/anything"} {
		cfg := base
		cfg.PublicHost = name
		if _, err := cfg.directMode(); err == nil {
			t.Errorf("accepted public-host %q", name)
		}
	}
}

func TestBootstrapRequiresBothFilesAbsent(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{CertFile: filepath.Join(dir, "fullchain"), KeyFile: filepath.Join(dir, "key")}
	loadErr := os.ErrNotExist
	if missing, err := missingPair(cfg, loadErr); err != nil || !missing {
		t.Fatal(missing, err)
	}
	if err := os.WriteFile(cfg.KeyFile, []byte("not a PEM"), 0600); err != nil {
		t.Fatal(err)
	}
	if missing, err := missingPair(cfg, loadErr); err == nil || missing {
		t.Fatal("allowed partially installed pair")
	}
	// A non-directory in a path causes ENOTDIR, not an absent pair.
	cfg.KeyFile = filepath.Join(cfg.KeyFile, "file")
	if missing, err := missingPair(cfg, loadErr); err == nil || errors.Is(err, os.ErrNotExist) || missing {
		t.Fatal("silenced a stat error", err)
	}
}

func TestChallengeServesOnlyExactTokens(t *testing.T) {
	webroot := t.TempDir()
	dir := filepath.Join(webroot, ".well-known", "acme-challenge")
	if err := os.MkdirAll(filepath.Join(dir, "folder"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "safe_123-XYZ"), []byte("key-authorization"), 0600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(webroot)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Close() }()
	serve := challengeHandler(root, "chat.example.test")
	for _, tc := range []struct {
		method, path string
		code         int
		body         string
	}{
		{"GET", challengePrefix + "safe_123-XYZ", 200, "key-authorization"},
		{"HEAD", challengePrefix + "safe_123-XYZ", 200, ""},
		{"POST", challengePrefix + "safe_123-XYZ", 405, ""},
		{"GET", challengePrefix, 404, ""},
		{"GET", "/.well-known/acme-challenge", 404, ""},
		{"GET", challengePrefix + "folder", 404, ""},
		{"GET", challengePrefix + "missing", 404, ""},
		{"GET", challengePrefix + "../secret", 404, ""},
		{"GET", challengePrefix + "%2e%2e%2fsecret", 404, ""},
		{"GET", challengePrefix + "%73afe_123-XYZ", 404, ""},
		{"GET", challengePrefix + "safe_123-XYZ.json", 404, ""},
	} {
		w := httptest.NewRecorder()
		serve(w, httptest.NewRequest(tc.method, "http://untrusted.test"+tc.path, nil))
		if w.Code != tc.code || tc.code == 200 && w.Body.String() != tc.body {
			t.Errorf("%s %s: got %d %q", tc.method, tc.path, w.Code, w.Body.String())
		}
	}
	for _, path := range []string{"/?ch=lobby", "//attacker.test/chat", "/some%20channel?x=1"} {
		w := httptest.NewRecorder()
		serve(w, httptest.NewRequest("GET", "http://untrusted.test"+path, nil))
		if w.Code != 308 || w.Header().Get("Location") != "https://chat.example.test"+path {
			t.Errorf("%s: %d %q", path, w.Code, w.Header().Get("Location"))
		}
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(dir, "secret")); err != nil {
		t.Skip("symlinks unavailable", err)
	}
	verify := func() {
		t.Helper()
		w := httptest.NewRecorder()
		serve(w, httptest.NewRequest("GET", "http://localhost"+challengePrefix+"secret", nil))
		if w.Code != 404 {
			t.Fatal("served an escaping symlink", w.Code)
		}
	}
	verify()
	if err := os.Rename(dir, dir+"-old"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, dir); err != nil {
		t.Fatal(err)
	}
	verify()
}
