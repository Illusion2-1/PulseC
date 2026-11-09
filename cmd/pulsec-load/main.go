// pulsec-load measures delivery through the local development relay using independent QUIC connections.
package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	wt "github.com/quic-go/webtransport-go"
)

type client struct {
	stream  *wt.Stream
	room    string
	ready   chan struct{}
	barrier chan struct{}
	mu      sync.Mutex
	seen    []bool
	acked   []bool
	latency []float64
}
type result struct {
	Clients, Rooms, Submitted, Ack, Expected, Delivered, Invalid, Disconnects                    int
	SetupMiB, JoinSeconds, ElapsedSeconds, MessagesPerSec, DeliveriesPerSec, P50ms, P95ms, P99ms float64
}

func run() (result, error) {
	addr := flag.String("addr", "127.0.0.1:18461", "loopback development relay")
	n := flag.Int("clients", 256, "independent WT sessions")
	rooms := flag.Int("rooms", 1, "evenly populated channels")
	rate := flag.Int("rate", 64, "total submitted messages per second")
	duration := flag.Int("seconds", 12, "seconds of steady input")
	ramp := flag.Int("join-rate", 80, "new sessions per second")
	flag.Parse()
	host, _, err := net.SplitHostPort(*addr)
	if err != nil || !net.ParseIP(host).IsLoopback() || *n < 1 || *rooms < 1 || *n%*rooms != 0 || *rate < 1 || *duration < 1 || *ramp < 1 {
		return result{}, errors.New("require loopback IP, positive load, and clients divisible by rooms")
	}
	origin := "http://" + *addr
	req := http.Client{Timeout: 3 * time.Second}
	rsp, err := req.Get(origin + "/config")
	if err != nil {
		return result{}, err
	}
	defer func() { _ = rsp.Body.Close() }()
	var conf struct{ Pin string }
	if err = json.NewDecoder(rsp.Body).Decode(&conf); err != nil {
		return result{}, err
	}
	pin, err := base64.StdEncoding.DecodeString(conf.Pin)
	if err != nil || len(pin) != 32 {
		return result{}, errors.New("expected local certificate pin")
	}
	transport := wt.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true, VerifyConnection: func(cs tls.ConnectionState) error {
		hash := sha256.Sum256(cs.PeerCertificates[0].Raw)
		if subtle.ConstantTimeCompare(hash[:], pin) != 1 {
			return errors.New("certificate pin mismatch")
		}
		return nil
	}}}
	total := *rate * *duration
	clients := make([]client, *n)
	timestamps := make([]atomic.Int64, total)
	var invalid, disconnected, received, acks, setupBytes atomic.Int64
	epoch := time.Now()
	errs := make(chan error, len(clients))
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*n / *ramp + 45)*time.Second)
	defer cancel()
	var joins sync.WaitGroup
	for i := range clients {
		time.Sleep(time.Until(epoch.Add(time.Duration(i) * time.Second / time.Duration(*ramp))))
		c := &clients[i]
		c.room = fmt.Sprintf("load-%d", i%*rooms)
		c.ready = make(chan struct{})
		c.barrier = make(chan struct{})
		c.seen = make([]bool, total)
		c.acked = make([]bool, total)
		joins.Go(func() {
			_, sess, e := transport.Dial(ctx, "https://"+*addr+"/connect", http.Header{"Origin": []string{origin}})
			if e != nil {
				errs <- e
				return
			}
			c.stream, e = sess.OpenStreamSync(ctx)
			if e != nil {
				errs <- e
				return
			}
			go func() {
				scan := bufio.NewScanner(c.stream)
				scan.Buffer(make([]byte, 4096), 8<<20)
				for scan.Scan() {
					arrival := time.Since(epoch).Nanoseconds()
					var msg struct{ Op, Room, Text, ID string }
					if json.Unmarshal(scan.Bytes(), &msg) != nil {
						invalid.Add(1)
						continue
					}
					switch msg.Op {
					case "state":
						select {
						case <-c.ready:
						default:
							close(c.ready)
						}
					case "pong":
						if msg.ID == "barrier" {
							select {
							case <-c.barrier:
							default:
								close(c.barrier)
							}
						}
					case "message", "ack":
						var seq int
						var e error
						if msg.Op == "ack" {
							seq, e = strconv.Atoi(msg.ID)
						} else {
							seq, e = strconv.Atoi(strings.SplitN(msg.Text, " ", 2)[0])
						}
						if e != nil || seq < 0 || seq >= total || timestamps[seq].Load() == 0 {
							invalid.Add(1)
							continue
						}
						c.mu.Lock()
						if msg.Op == "ack" {
							if seq%*n != i || c.acked[seq] {
								invalid.Add(1)
							} else {
								c.acked[seq] = true
								acks.Add(1)
							}
						} else if c.seen[seq] || msg.Room != c.room || (seq%*n)%*rooms != i%*rooms {
							invalid.Add(1)
						} else {
							c.seen[seq] = true
							c.latency = append(c.latency, float64(arrival-timestamps[seq].Load())/1e6)
							received.Add(1)
						}
						c.mu.Unlock()
					case "error", "limited":
						invalid.Add(1)
					}
					select {
					case <-c.barrier:
					default:
						setupBytes.Add(int64(len(scan.Bytes()) + 1))
					}
				}
				disconnected.Add(1)
			}()
			_, e = fmt.Fprintf(c.stream, "{\"op\":\"identity\",\"nick\":\"u%d\",\"proof\":\"%064x\",\"rosterDelta\":true}\n{\"op\":\"join\",\"room\":%q}\n", i, i+1, c.room)
			if e != nil {
				errs <- e
				return
			}
			select {
			case <-c.ready:
			case <-ctx.Done():
				errs <- ctx.Err()
			}
		})
	}
	joins.Wait()
	close(errs)
	for e := range errs {
		return result{}, e
	}
	for i := range clients {
		if _, err := fmt.Fprintln(clients[i].stream, `{"op":"ping","id":"barrier"}`); err != nil {
			return result{}, err
		}
	}
	for i := range clients {
		select {
		case <-clients[i].barrier:
		case <-ctx.Done():
			return result{}, fmt.Errorf("join barrier: %w", ctx.Err())
		}
	}
	res := result{Clients: *n, Rooms: *rooms, JoinSeconds: time.Since(epoch).Seconds(), SetupMiB: float64(setupBytes.Load()) / (1 << 20), Expected: total * (*n / *rooms)}
	fmt.Fprintln(os.Stderr, "joined")
	start := time.Now()
	for seq := 0; seq < total; seq++ {
		time.Sleep(time.Until(start.Add(time.Duration(seq) * time.Second / time.Duration(*rate))))
		c := &clients[seq%*n]
		body := fmt.Sprintf("%08d %s", seq, strings.Repeat("x", 119))
		wire := fmt.Sprintf("{\"op\":\"send\",\"kind\":\"chat\",\"room\":%q,\"id\":\"%036d\",\"text\":%q}\n", c.room, seq, body)
		timestamps[seq].Store(time.Since(epoch).Nanoseconds())
		if _, err := c.stream.Write([]byte(wire)); err != nil {
			invalid.Add(1)
		} else {
			res.Submitted++
		}
	}
	deadline := start.Add(time.Duration(*duration+5) * time.Second)
	for (received.Load() < int64(res.Expected) || acks.Load() < int64(total)) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	res.ElapsedSeconds = math.Max(float64(*duration), time.Since(start).Seconds())
	res.Ack = int(acks.Load())
	res.Invalid = int(invalid.Load())
	res.Disconnects = int(disconnected.Load())
	var delays []float64
	for i := range clients {
		c := &clients[i]
		c.mu.Lock()
		delays = append(delays, c.latency...)
		c.mu.Unlock()
	}
	res.Delivered = len(delays)
	res.DeliveriesPerSec = float64(res.Delivered) / res.ElapsedSeconds
	res.MessagesPerSec = float64(res.Ack) / res.ElapsedSeconds
	if len(delays) > 0 {
		slices.Sort(delays)
		quant := func(p float64) float64 { return delays[int(math.Ceil(p*float64(len(delays))))-1] }
		res.P50ms = quant(.50)
		res.P95ms = quant(.95)
		res.P99ms = quant(.99)
	}
	return res, nil
}
func main() {
	r, err := run()
	if err != nil {
		log.Fatal(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(r); err != nil {
		log.Fatal(err)
	}
	if r.Delivered != r.Expected || r.Invalid+r.Disconnects != 0 || r.Ack != r.Submitted {
		os.Exit(1)
	}
}
