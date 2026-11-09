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
	"os"
	"time"
)

// A public listener uses the supplied chain. Only the local development
// endpoint bootstraps WebTransport using a short-lived certificate pin.
func loadCertificate(cfg Config) (tls.Certificate, string, error) {
	if cfg.CertFile != "" || cfg.KeyFile != "" {
		cert, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
		return cert, "", err
	}
	host, _, err := net.SplitHostPort(cfg.Addr)
	if err != nil || !loopbackHost(host) {
		return tls.Certificate{}, "", errors.New("public listeners require -cert and -key")
	}
	return localCert()
}

// A dangling file symlink is a broken installation, not a fresh issuance.
func missingPair(cfg Config, loadErr error) (bool, error) {
	for _, path := range []string{cfg.CertFile, cfg.KeyFile} {
		_, err := os.Lstat(path)
		if err == nil {
			return false, loadErr
		}
		if !errors.Is(err, os.ErrNotExist) {
			return false, err
		}
	}
	return true, nil
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
