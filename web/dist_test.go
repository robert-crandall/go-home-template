package web

import (
	"io/fs"
	"testing"
)

// TestDistHasIndex guards the mistake server.New panics on: a missing fs.Sub,
// which leaves index.html buried under build/ instead of at the root.
func TestDistHasIndex(t *testing.T) {
	f, err := Dist.Open("index.html")
	if err != nil {
		t.Fatalf("embedded SPA has no index.html at its root: %v", err)
	}
	_ = f.Close()
}

// TestDistHasAppChunks guards the mistake nothing panics on: dropping `all:`
// from the embed directive. index.html is embedded either way, so the binary
// boots fine and then 404s every script tag it references.
func TestDistHasAppChunks(t *testing.T) {
	matches, err := fs.Glob(Dist, "_app/immutable/entry/*.js")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(matches) == 0 {
		t.Fatal("embedded SPA has no _app/immutable chunks - did the embed directive lose its `all:` prefix?")
	}
}
