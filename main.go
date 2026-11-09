package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"os/signal"
	"syscall"

	"pulsec/internal/server"
)

//go:embed all:web/build
var assets embed.FS

func main() {
	var cfg server.Config
	flag.StringVar(&cfg.Addr, "addr", "127.0.0.1:8443", "TCP and UDP listen address")
	flag.StringVar(&cfg.CertFile, "cert", "", "HTTPS certificate chain")
	flag.StringVar(&cfg.KeyFile, "key", "", "HTTPS private key")
	flag.IntVar(&cfg.MaxSessions, "max-sessions", 1024, "maximum simultaneous WebTransport sessions (1–4096)")
	flag.IntVar(&cfg.SourceRate, "source-rate", 128, "messages per second per source IP across trips (1–4096; burst is twice the rate)")
	flag.DurationVar(&cfg.StatsInterval, "stats-interval", 0, "print anonymous aggregate counters periodically (0 disables)")
	version := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *version {
		fmt.Println("PulseC 0.1.0-rc.1")
		return
	}

	// Transport libraries can log peer-supplied errors. Only the explicit
	// operator logger may write process events and aggregated counters.
	logger := log.New(os.Stderr, "", log.LstdFlags)
	log.SetOutput(io.Discard)
	static, err := fs.Sub(assets, "web/build")
	if err != nil {
		logger.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	reload := make(chan os.Signal, 1)
	signal.Notify(reload, syscall.SIGHUP)
	defer signal.Stop(reload)
	if err := server.Run(ctx, cfg, static, logger, reload); err != nil {
		logger.Fatal(err)
	}
}
