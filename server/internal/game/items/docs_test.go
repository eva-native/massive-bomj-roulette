package items_test

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"testing"

	"github.com/eva-native/massive-bomj-roulette/server/internal/game"
	"github.com/eva-native/massive-bomj-roulette/server/internal/game/items"
)

const rulesDir = "../../../../docs/rules"

// TestCatalogMatchesDocs: every item of docs/rules is in the catalog with
// the right kind, and nothing else is.
func TestCatalogMatchesDocs(t *testing.T) {
	idRe := regexp.MustCompile("(?m)^### .+\n`([a-z0-9_]+)`")
	want := map[string]game.Kind{}
	for file, kind := range map[string]game.Kind{"effects.md": game.KindEffect, "bonuses.md": game.KindBonus, "drop-debuffs.md": game.KindDrop} {
		b, err := os.ReadFile(filepath.Join(rulesDir, file))
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range idRe.FindAllSubmatch(b, -1) {
			want[string(m[1])] = kind
		}
	}

	got := map[string]game.Kind{}
	for _, d := range items.Defs() {
		got[d.ID] = d.Kind
		if d.Name == "" || d.Concept == "" {
			t.Errorf("%s: empty name or rule text", d.ID)
		}
	}
	for id, kind := range want {
		if got[id] != kind {
			t.Errorf("%s: kind %q in the catalog, %q in docs/rules", id, got[id], kind)
		}
	}
	for id := range got {
		if _, ok := want[id]; !ok {
			t.Errorf("%s is in the catalog but not in docs/rules", id)
		}
	}
	if len(want) != 48 {
		ids := make([]string, 0, len(want))
		for id := range want {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		t.Errorf("docs/rules lists %d items, expected 48: %v", len(want), ids)
	}
}

// TestTextsAreGenerated: texts_gen.go is what the generator makes from the
// current docs/rules (run `go generate ./internal/game/items` after editing them).
func TestTextsAreGenerated(t *testing.T) {
	if testing.Short() {
		t.Skip("runs the generator")
	}
	out := filepath.Join(t.TempDir(), "texts_gen.go")
	cmd := exec.Command("go", "run", "./gen", rulesDir, out)
	if msg, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("generator: %v\n%s", err, msg)
	}
	fresh, _ := os.ReadFile(out)
	current, _ := os.ReadFile("texts_gen.go")
	if !bytes.Equal(fresh, current) {
		t.Fatal("texts_gen.go is out of date: run `go generate ./internal/game/items`")
	}
}
