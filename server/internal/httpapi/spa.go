package httpapi

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

const notBuilt = "Frontend is not built. Run `npm run build` in web/, or use the Vite dev server (npm run dev)."

// spaHandler serves the built frontend. Unknown paths without a file
// extension fall back to index.html so client-side routes work on reload.
func spaHandler(web fs.FS) http.Handler {
	files := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" && name != "index.html" {
			if _, err := fs.Stat(web, name); err == nil {
				if strings.HasPrefix(name, "assets/") {
					// Vite puts a content hash in asset names, so they never change.
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
			if path.Ext(name) != "" {
				http.NotFound(w, r)
				return
			}
		}
		index, err := fs.ReadFile(web, "index.html")
		if errors.Is(err, fs.ErrNotExist) {
			http.Error(w, notBuilt, http.StatusServiceUnavailable)
			return
		}
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(index)
	})
}
