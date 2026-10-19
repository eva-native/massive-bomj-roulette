# Builds the frontend, embeds it into the Go binary and ships a minimal image.

FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /web/dist ./internal/webui/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /mbr ./cmd/mbr

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /mbr /mbr
EXPOSE 8080
ENTRYPOINT ["/mbr"]
