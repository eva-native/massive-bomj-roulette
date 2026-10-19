// Package webui embeds the built frontend (web/dist).
//
// The build copies web/dist into ./dist before `go build`. Without it the
// server still runs and serves a short notice instead of the app.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// FS returns the frontend files rooted at dist/.
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // dist always exists (it holds at least .gitkeep)
	}
	return sub
}
