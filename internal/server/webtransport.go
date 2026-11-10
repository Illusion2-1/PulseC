package server

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"

	"pulsec/internal/chat"
	"pulsec/internal/protocol"
	"pulsec/internal/ratelimit"
)

// The session limit also applies before identity, including visitors who only browse the directory.
type ingress struct {
	slots      chan struct{}
	denied     atomic.Uint64
	failures   atomic.Uint64
	slow       atomic.Uint64
	mu         sync.Mutex
	handshakes ratelimit.Bucket
	sessions   ratelimit.Bucket
}

func newIngress(n int) *ingress { return &ingress{slots: make(chan struct{}, n)} }

func (g *ingress) allowStart(b *ratelimit.Bucket) bool {
	g.mu.Lock()
	ok := b.Take(time.Now(), time.Second/128, 128)
	g.mu.Unlock()
	if !ok {
		g.denied.Add(1)
	}
	return ok
}

func (g *ingress) acquire() bool {
	if !g.allowStart(&g.sessions) {
		return false
	}
	select {
	case g.slots <- struct{}{}:
		return true
	default:
		g.denied.Add(1)
		return false
	}
}

// Bound incomplete handshakes by their global arrival rate and lifetime, and
// established HTTP/3 connections separately from CONNECT sessions.
func (g *ingress) configure(wt *webtransport.Server) {
	q := &quic.Config{EnableDatagrams: true, EnableStreamResetPartialDelivery: true, MaxIncomingStreams: 16, MaxIncomingUniStreams: 8, HandshakeIdleTimeout: 5 * time.Second,
		InitialStreamReceiveWindow: 64 << 10, MaxStreamReceiveWindow: 256 << 10, InitialConnectionReceiveWindow: 256 << 10, MaxConnectionReceiveWindow: 1 << 20}
	q.GetConfigForClient = func(*quic.ClientInfo) (*quic.Config, error) {
		if !g.allowStart(&g.handshakes) {
			return nil, errors.New("at capacity")
		}
		return q, nil
	}
	connections := make(chan struct{}, cap(g.slots))
	wt.H3.QUICConfig = q
	wt.H3.MaxHeaderBytes = 16 << 10
	wt.H3.Logger = slog.New(slog.DiscardHandler)
	wt.H3.ConnContext = func(ctx context.Context, c *quic.Conn) context.Context {
		select {
		case connections <- struct{}{}:
			context.AfterFunc(c.Context(), func() { <-connections })
		default:
			g.denied.Add(1)
			_ = c.CloseWithError(quic.ApplicationErrorCode(http3.ErrCodeExcessiveLoad), "capacity")
		}
		return ctx
	}
	wt.Config = &webtransport.Config{MaxIncomingStreams: 1, MaxIncomingUniStreams: -1}
}

func loopbackHost(authority string) bool {
	host := authority
	if h, _, e := net.SplitHostPort(authority); e == nil {
		host = h
	} else {
		host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	}
	return strings.EqualFold(host, "localhost") || net.ParseIP(host).IsLoopback()
}

func browserHeaders(local bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
		if local && !loopbackHost(r.Host) {
			http.Error(w, "loopback host required", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (g *ingress) connect(wt *webtransport.Server, h *chat.Hub, local bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.ProtoMajor != 3 || r.Method != http.MethodConnect {
			http.Error(w, "WebTransport required", http.StatusBadRequest)
			return
		}
		scheme := "https://"
		if local {
			scheme = "http://"
		}
		origins := r.Header.Values("Origin")
		if len(origins) != 1 || origins[0] != scheme+r.Host {
			http.Error(w, "origin", http.StatusForbidden)
			return
		}
		if !g.acquire() {
			http.Error(w, "at capacity", http.StatusServiceUnavailable)
			return
		}
		defer func() { <-g.slots }()
		sess, err := wt.Upgrade(w, r)
		if err != nil {
			g.failures.Add(1)
			return
		}
		closeSession := func() { _ = sess.CloseWithError(0, "closed") }
		defer closeSession()
		ctx, cancel := context.WithTimeout(sess.Context(), 10*time.Second)
		stream, err := sess.AcceptStream(ctx)
		cancel()
		if err != nil {
			g.failures.Add(1)
			return
		}
		remote, err := netip.ParseAddrPort(r.RemoteAddr)
		if err != nil {
			g.failures.Add(1)
			return
		}
		if stream.SetWriteDeadline(time.Now().Add(15*time.Second)) != nil {
			return
		}
		if _, err := stream.Write(protocol.Connection("WebTransport", tls.VersionName(r.TLS.Version))); err != nil {
			return
		}
		p := chat.NewPeer(remote.Addr())
		defer func() {
			if h.Remove(p) {
				g.slow.Add(1)
			}
		}()
		go func() {
			defer closeSession()
			for {
				select {
				case <-p.Done():
					return
				case <-sess.Context().Done():
					return
				case data := <-p.Outbound():
					if stream.SetWriteDeadline(time.Now().Add(15*time.Second)) != nil {
						return
					}
					if _, err := stream.Write(data); err != nil {
						return
					}
				}
			}
		}()
		reader := protocol.NewReader(stream)
		for {
			if stream.SetReadDeadline(time.Now().Add(90*time.Second)) != nil {
				return
			}
			c, err := reader.ReadCommand()
			if err != nil {
				if errors.Is(err, protocol.ErrInvalidCommand) {
					g.failures.Add(1)
				}
				return
			}
			if !h.Handle(p, c) {
				g.failures.Add(1)
				return
			}
		}
	}
}
