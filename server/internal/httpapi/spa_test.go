package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSPAHandler(t *testing.T) {
	web := fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/app.js": {Data: []byte("console.log(1)")},
		"favicon.svg":   {Data: []byte("<svg/>")},
	}
	h := spaHandler(web)

	tests := []struct {
		path      string
		status    int
		body      string
		immutable bool
	}{
		{"/", 200, "<html>app</html>", false},
		{"/events/abc", 200, "<html>app</html>", false}, // client-side route
		{"/assets/app.js", 200, "console.log(1)", true},
		{"/favicon.svg", 200, "<svg/>", false},
		{"/missing.js", 404, "", false},
	}
	for _, tt := range tests {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.path, nil))
		if rec.Code != tt.status {
			t.Errorf("%s: status %d, want %d", tt.path, rec.Code, tt.status)
		}
		if tt.body != "" && rec.Body.String() != tt.body {
			t.Errorf("%s: body %q, want %q", tt.path, rec.Body.String(), tt.body)
		}
		if got := strings.Contains(rec.Header().Get("Cache-Control"), "immutable"); got != tt.immutable {
			t.Errorf("%s: immutable cache = %v, want %v", tt.path, got, tt.immutable)
		}
	}
}

func TestSPAHandlerNotBuilt(t *testing.T) {
	rec := httptest.NewRecorder()
	spaHandler(fstest.MapFS{".gitkeep": {}}).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "not built") {
		t.Errorf("got %d %q, want 503 with a hint", rec.Code, rec.Body.String())
	}
}
