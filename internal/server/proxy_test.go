package server

import (
	"bytes"
	"crypto/x509"
	"testing"
)

func TestBehindProxyRequiresNumericLoopback(t *testing.T) {
	for _, addr := range []string{"127.0.0.1:8443", "127.0.0.2:1234", "[::1]:8443"} {
		cfg := Config{BehindProxy: true, Addr: addr}
		first, pin, err := loadCertificate(cfg)
		if err != nil || pin != "" || len(first.Certificate) != 1 {
			t.Fatalf("%s: invalid origin certificate or exposed pin: %v", addr, err)
		}
		cert, err := x509.ParseCertificate(first.Certificate[0])
		if err != nil {
			t.Fatal(err)
		}
		if err := cert.CheckSignature(cert.SignatureAlgorithm, cert.RawTBSCertificate, cert.Signature); err != nil {
			t.Fatal(err)
		}
		second, _, err := loadCertificate(cfg)
		if err != nil || bytes.Equal(first.Certificate[0], second.Certificate[0]) {
			t.Fatal("origin certificate reused", err)
		}
	}
	for _, addr := range []string{":8443", "0.0.0.0:8443", "[::]:8443", "192.0.2.1:8443", "[2001:db8::1]:8443", "localhost:8443", "127.0.0.1:https"} {
		if _, _, err := loadCertificate(Config{BehindProxy: true, Addr: addr}); err == nil {
			t.Errorf("allowed proxy listener %q", addr)
		}
	}
	for _, cfg := range []Config{{CertFile: "cert"}, {KeyFile: "key"}, {PublicHost: "chat.test"}, {HTTPAddr: ":80"}, {ACMEWebroot: "webroot"}} {
		cfg.BehindProxy = true
		cfg.Addr = "127.0.0.1:8443"
		if _, _, err := loadCertificate(cfg); err == nil {
			t.Errorf("allowed conflicting proxy configuration: %+v", cfg)
		}
	}
	_, pin, err := loadCertificate(Config{Addr: "localhost:8443"})
	if err != nil || pin == "" {
		t.Fatal("missing development pin", err)
	}
}
