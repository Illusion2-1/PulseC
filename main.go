package main

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
	"io/fs"
	"log"
	"math/big"
	"net"
	"net/http"
	"time"
)

//go:embed all:web/build
var assets embed.FS

func localCert() (tls.Certificate, string, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	now := time.Now()
	cert := &x509.Certificate{SerialNumber: big.NewInt(now.UnixNano()), NotBefore: now.Add(-time.Minute), NotAfter: now.Add(13 * 24 * time.Hour), DNSNames: []string{"localhost"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	hash := sha256.Sum256(der)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, base64.StdEncoding.EncodeToString(hash[:]), err
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8443", "TCP and UDP listen address")
	certFile := flag.String("cert", "", "HTTPS certificate chain")
	keyFile := flag.String("key", "", "HTTPS private key")
	version := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *version {
		fmt.Println("PulseC 0.1.0-rc.1")
		return
	}
	var cert tls.Certificate
	var pin string
	var err error
	local := *certFile == "" && *keyFile == ""
	if local {
		host, _, e := net.SplitHostPort(*addr)
		if e != nil || !(host == "localhost" || net.ParseIP(host).IsLoopback()) {
			log.Fatal("public listeners require -cert and -key")
		}
		cert, pin, err = localCert()
	} else {
		cert, err = tls.LoadX509KeyPair(*certFile, *keyFile)
	}
	if err != nil {
		log.Fatal(err)
	}
	conf := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}
	mux := http.NewServeMux()
	wt := &webtransport.Server{H3: &http3.Server{Addr: *addr, TLSConfig: http3.ConfigureTLSConfig(conf.Clone()), Handler: mux}}
	hub := newHub()
	mux.HandleFunc("/connect", func(w http.ResponseWriter, r *http.Request) {
		if r.ProtoMajor != 3 || r.Method != "CONNECT" {
			http.Error(w, "WebTransport required", 400)
			return
		}
		// The development page uses HTTP loopback, production always uses HTTPS.
		scheme := "https://"
		if local {
			scheme = "http://"
		}
		if r.Header.Get("Origin") != scheme+r.Host {
			http.Error(w, "origin", 403)
			return
		}
		sess, e := wt.Upgrade(w, r)
		if e != nil {
			return
		}
		defer sess.CloseWithError(0, "closed")
		ctx, cancel := context.WithTimeout(sess.Context(), 10*time.Second)
		defer cancel()
		stream, e := sess.AcceptStream(ctx)
		if e != nil {
			return
		}
		p := &peer{send: make(chan []byte, 64), rooms: map[string]bool{}, stop: make(chan struct{})}
		defer hub.remove(p)
		go func() {
			defer sess.CloseWithError(0, "closed")
			for {
				select {
				case <-p.stop:
					return
				case <-sess.Context().Done():
					return
				case data := <-p.send:
					stream.SetWriteDeadline(time.Now().Add(15 * time.Second))
					if _, e := stream.Write(data); e != nil {
						return
					}
				}
			}
		}()
		scanner := bufio.NewScanner(stream)
		scanner.Buffer(make([]byte, 2048), 32768)
		for {
			stream.SetReadDeadline(time.Now().Add(90 * time.Second))
			if !scanner.Scan() {
				return
			}
			var c command
			if json.Unmarshal(scanner.Bytes(), &c) != nil {
				return
			}
			if !hub.handle(p, c) {
				return
			}
		}
	})
	mux.HandleFunc("GET /config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"pin": pin, "boot": hub.start.UTC().Format(time.RFC3339Nano)})
	})
	static, _ := fs.Sub(assets, "web/build")
	mux.Handle("/", http.FileServerFS(static))
	server := &http.Server{Addr: *addr, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if local {
			host, _, _ := net.SplitHostPort(r.Host)
			if host != "localhost" && !net.ParseIP(host).IsLoopback() {
				http.Error(w, "loopback host required", 403)
				return
			}
		}
		mux.ServeHTTP(w, r)
	}), TLSConfig: conf, ReadHeaderTimeout: 5 * time.Second}
	go func() { log.Fatal(wt.ListenAndServe()) }()
	if local {
		log.Printf("PulseC http://%s (local certificate valid for 13 days)", *addr)
		log.Fatal(server.ListenAndServe())
	}
	log.Printf("PulseC HTTPS + HTTP/3 on %s", *addr)
	log.Fatal(server.ListenAndServeTLS("", ""))
}
