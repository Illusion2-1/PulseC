.PHONY: build frontend install-web web-check go-check smoke test check tools security
export PATH := $(CURDIR)/dist/tools:$(PATH)
GO_BUILD := CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w"

build: frontend
	$(GO_BUILD) -o dist/pulsec .

frontend: install-web
	cd web && npm run build

install-web:
	cd web && npm ci --no-audit --no-fund

web-check: install-web
	cd web && npm run format:check && npm run lint && npm run check && npm test

go-check: frontend
	@test -z "$$(gofmt -l $$(git ls-files '*.go'))" || { gofmt -l $$(git ls-files '*.go'); exit 1; }
	go test -race ./...
	go vet ./...
	golangci-lint run ./...

test: frontend
	cd web && npm test
	go test -race ./...

smoke: build
	$(GO_BUILD) -o dist/pulsec-load ./cmd/pulsec-load
	python3 tools/smoke.py dist/pulsec dist/pulsec-load
	PULSEC_BIN="$(CURDIR)/dist/pulsec" go test -count=1 ./qa

check: web-check go-check smoke

tools:
	GOBIN="$(CURDIR)/dist/tools" go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.11.3
	GOBIN="$(CURDIR)/dist/tools" go install golang.org/x/vuln/cmd/govulncheck@v1.9.0
	GOBIN="$(CURDIR)/dist/tools" go install github.com/zricethezav/gitleaks/v8@v8.30.1

security: frontend
	go mod verify
	govulncheck ./...
	cd web && npm audit --audit-level=high
	cd qa && npm audit --package-lock-only --audit-level=high
	gitleaks git --redact --no-banner --log-opts=--all .
