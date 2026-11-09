.PHONY: build frontend test
build: frontend
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o dist/pulsec .
frontend:
	cd web && npm ci --no-audit --no-fund && npm run build
test: frontend
	go test -race ./...
