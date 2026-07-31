package web

import (
	"encoding/json"
	"fmt"
	"image"
	_ "image/png"
	"io/fs"
	"strings"
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

// TestIndexHTMLAppliesThemeBeforeBody checks that the theme script survived into
// the build, is still in <head>, and is still a classic script.
//
// All three matter for the same reason: the script is what applies a saved theme
// before the first paint. Moving it below <body> delays it, and `type="module"`
// defers it to after parsing - either one reintroduces the flash of the wrong
// palette without breaking anything a browser test that waits for the page would
// notice.
//
// Not asserted: that the script precedes the stylesheet link. A render-blocking
// stylesheet means nothing paints until the CSS has loaded, and a parser-blocking
// inline script in <head> has run by then regardless of which came first, so the
// ordering is a preference rather than a correctness property.
func TestIndexHTMLAppliesThemeBeforeBody(t *testing.T) {
	html := readDist(t, "index.html")

	script := strings.Index(html, "localStorage.getItem('theme')")
	if script < 0 {
		t.Fatal("index.html has no inline theme script - a saved theme now applies only after the app boots, which is a frame of the wrong palette")
	}
	if body := strings.Index(html, "<body"); body < 0 || script > body {
		t.Error("the inline theme script is not in <head> - it has to run before the body parses")
	}

	// The opening tag of the script that contains the storage read.
	open := strings.LastIndex(html[:script], "<script")
	if open < 0 {
		t.Fatal("the theme storage read is not inside a <script> tag")
	}
	tag := html[open:script]
	if strings.Contains(tag, "type=\"module\"") || strings.Contains(tag, "type='module'") {
		t.Error("the inline theme script is a module, so the browser defers it until after parsing - it has to be a classic script to run before the first paint")
	}

	if !strings.Contains(html, `rel="manifest"`) {
		t.Error("index.html does not link the web manifest")
	}
}

// TestIndexHTMLHasNoUnsubstitutedPlaceholders catches a silent, self-inflicted
// way to ship an unstyled app: SvelteKit substitutes the *first* occurrence of
// each %sveltekit.*% token, so merely naming one in a comment swallows the
// injected stylesheet link into that comment and leaves the real placeholder
// below as literal text. The page still serves a 200 and still has an index.
func TestIndexHTMLHasNoUnsubstitutedPlaceholders(t *testing.T) {
	if html := readDist(t, "index.html"); strings.Contains(html, "%sveltekit.") {
		t.Error("index.html still contains an unsubstituted sveltekit placeholder - one of them was consumed earlier in the file, probably by a comment that named it")
	}
}

// TestManifestIconsResolve is the one that earns its keep. The foundation's SPA
// handler falls back to index.html for any path it can't open, so a typo'd icon
// src is served as HTML with a 200: every manual check looks fine and the
// browser quietly has no icon. Declared sizes get the same treatment - they're
// checked against the file's real pixels, because a manifest that lies about
// 512x512 is a manifest the browser will reject on its own terms.
func TestManifestIconsResolve(t *testing.T) {
	var manifest struct {
		Name  string `json:"name"`
		Icons []struct {
			Src   string `json:"src"`
			Sizes string `json:"sizes"`
		} `json:"icons"`
	}
	if err := json.Unmarshal([]byte(readDist(t, "manifest.webmanifest")), &manifest); err != nil {
		t.Fatalf("manifest.webmanifest is not valid JSON: %v", err)
	}

	if manifest.Name == "" {
		t.Error("the manifest has no name, so an installed app would be titled after its URL")
	}
	if len(manifest.Icons) == 0 {
		t.Fatal("the manifest declares no icons")
	}

	for _, icon := range manifest.Icons {
		path := strings.TrimPrefix(icon.Src, "/")
		f, err := Dist.Open(path)
		if err != nil {
			t.Errorf("manifest icon %q is not in the embedded SPA: %v", icon.Src, err)
			continue
		}
		cfg, _, err := image.DecodeConfig(f)
		_ = f.Close()
		if err != nil {
			t.Errorf("manifest icon %q does not decode as an image: %v", icon.Src, err)
			continue
		}
		if got := fmt.Sprintf("%dx%d", cfg.Width, cfg.Height); got != icon.Sizes {
			t.Errorf("manifest icon %q declares sizes %q but is really %s", icon.Src, icon.Sizes, got)
		}
	}
}

func readDist(t *testing.T, name string) string {
	t.Helper()
	b, err := fs.ReadFile(Dist, name)
	if err != nil {
		t.Fatalf("embedded SPA has no %s: %v", name, err)
	}
	return string(b)
}
