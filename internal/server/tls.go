package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"math/big"
	"net"
	"net/netip"
	"os"
	"time"
)

// A public listener uses the supplied chain. Only the local development
// endpoint bootstraps WebTransport using a short-lived certificate pin.
func loadCertificate(cfg Config) (tls.Certificate, string, error) {
	if cfg.BehindProxy {
		addr, err := netip.ParseAddrPort(cfg.Addr)
		if err != nil || !addr.Addr().IsLoopback() {
			return tls.Certificate{}, "", errors.New("-behind-proxy requires a numeric loopback -addr")
		}
		if cfg.CertFile != "" || cfg.KeyFile != "" || cfg.HTTPAddr != "" || cfg.ACMEWebroot != "" || cfg.PublicHost != "" {
			return tls.Certificate{}, "", errors.New("-behind-proxy cannot be combined with certificate or direct deployment flags")
		}
		cert, _, err := localCert()
		return cert, "", err
	}
	if cfg.CertFile != "" || cfg.KeyFile != "" {
		cert, err := readOperatorPair(cfg)
		return cert, "", err
	}
	host, _, err := net.SplitHostPort(cfg.Addr)
	if err != nil || !loopbackHost(host) {
		return tls.Certificate{}, "", errors.New("public listeners require -cert and -key")
	}
	return localCert()
}

// An atomic rename publishes the combined PEM used by the direct deployment.
func readOperatorPair(cfg Config) (tls.Certificate, error) {
	if cfg.CertFile == cfg.KeyFile {
		pem, err := os.ReadFile(cfg.CertFile) // #nosec G304 -- configured by the server operator
		if err != nil {
			return tls.Certificate{}, err
		}
		return tls.X509KeyPair(pem, pem)
	}
	return tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
}

// A dangling file symlink is a broken installation, not a fresh issuance.
func missingPair(cfg Config) (bool, error) {
	absent := func(path string) (bool, error) {
		_, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			return true, nil
		}
		return false, err
	}
	missingCert, err := absent(cfg.CertFile)
	if err != nil || cfg.CertFile == cfg.KeyFile {
		return missingCert, err
	}
	missingKey, err := absent(cfg.KeyFile)
	if err != nil {
		return false, err
	}
	if missingCert != missingKey {
		return false, errors.New("incomplete initial TLS certificate/key pair")
	}
	return missingCert, nil
}

func localCert() (tls.Certificate, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	now := time.Now()
	template := x509.Certificate{
		SerialNumber: big.NewInt(now.UnixNano()), NotBefore: now.Add(-time.Minute),
		NotAfter: now.Add(13 * 24 * time.Hour), DNSNames: []string{"localhost"},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
		KeyUsage:    x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	hash := sha256.Sum256(der)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, base64.StdEncoding.EncodeToString(hash[:]), nil
}
