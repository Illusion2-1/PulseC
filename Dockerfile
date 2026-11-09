ARG NODE_IMAGE=node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
ARG GO_IMAGE=golang:1.26.10-bookworm@sha256:5de7c99eb78ca5e515a4c340235d0955ec5964a5071c492c15503d7c267da473

FROM ${NODE_IMAGE} AS ui
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM ${GO_IMAGE} AS compile
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
COPY --from=ui /src/web/build ./web/build
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/pulsec .

FROM scratch AS runtime
USER 65532:65532
EXPOSE 8443/tcp 8443/udp
ENTRYPOINT ["/pulsec"]
CMD ["-addr", ":8443", "-cert", "/tls/fullchain.pem", "-key", "/tls/privkey.pem"]

# Package/offline deployment: use the exact native Linux binary that passed QA.
FROM runtime AS artifact
ARG RELEASE_BINARY=dist/release/pulsec
COPY --chmod=0555 ${RELEASE_BINARY} /pulsec

# A source checkout builds its own self-contained image by default.
FROM runtime AS source
COPY --from=compile --chmod=0555 /out/pulsec /pulsec
