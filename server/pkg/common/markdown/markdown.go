// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package markdown renders Markdown to HTML using goldmark. It provides a
// configurable Renderer with functional options for GitHub Flavored Markdown
// (enabled by default), emoji shortcodes, syntax highlighting, raw HTML and
// table-of-contents generation.
//
// Basic usage:
//
//	html, err := markdown.ToHTML("# Hello\n\nSome **bold** text")
//	if err != nil {
//	    log.Fatal(err)
//	}
//
//	// Configurable renderer
//	r := markdown.NewRenderer(
//	    markdown.WithGFM(),
//	    markdown.WithEmoji(),
//	    markdown.WithHighlighting(),
//	    markdown.WithTOC(),
//	)
//	out, err := r.Render(md)
package markdown

import (
	"bytes"
	stdhtml "html"
	"fmt"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"

	emoji "github.com/yuin/goldmark-emoji"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
)

// config holds the renderer configuration populated by Option values.
type config struct {
	gfm          bool
	emoji        bool
	highlighting bool
	unsafe       bool
	toc          bool
}

// Option configures a Renderer.
type Option func(*config)

// WithGFM enables GitHub Flavored Markdown: tables, strikethrough, task
// lists and auto-linking of bare URLs. GFM is enabled by default; this
// option is provided for explicitness and to allow disabling via a custom
// Option.
func WithGFM() Option {
	return func(c *config) { c.gfm = true }
}

// WithEmoji enables emoji shortcodes (e.g. :smile: -> 😄).
func WithEmoji() Option {
	return func(c *config) { c.emoji = true }
}

// WithHighlighting enables Chroma-based syntax highlighting for fenced
// code blocks.
func WithHighlighting() Option {
	return func(c *config) { c.highlighting = true }
}

// WithUnsafe allows raw HTML to pass through to the output unchanged.
func WithUnsafe() Option {
	return func(c *config) { c.unsafe = true }
}

// WithTOC enables automatic heading IDs and prepends a table of contents
// (a <nav class="toc">…</nav> block) to the rendered HTML.
func WithTOC() Option {
	return func(c *config) { c.toc = true }
}

// Renderer renders Markdown to HTML according to its configured options.
type Renderer struct {
	md  goldmark.Markdown
	cfg config
	toc *tocTransformer
}

// NewRenderer returns a new Renderer. GFM is enabled by default; pass
// additional Option values to enable emoji, highlighting, raw HTML or TOC.
func NewRenderer(opts ...Option) *Renderer {
	cfg := config{gfm: true}
	for _, o := range opts {
		o(&cfg)
	}

	var exts []goldmark.Extender
	var parserOpts []parser.Option
	var rendererOpts []renderer.Option

	if cfg.gfm {
		exts = append(exts, extension.GFM)
	}
	if cfg.emoji {
		exts = append(exts, emoji.New())
	}
	if cfg.highlighting {
		exts = append(exts, highlighting.NewHighlighting(
			highlighting.WithStyle("monokai"),
		))
	}
	if cfg.unsafe {
		rendererOpts = append(rendererOpts, html.WithUnsafe())
	}

	var toc *tocTransformer
	if cfg.toc {
		// Attributes are required so that heading id attributes are emitted.
		parserOpts = append(parserOpts, parser.WithAttribute())
		toc = &tocTransformer{}
		parserOpts = append(parserOpts, parser.WithASTTransformers(
			util.Prioritized(toc, 100),
		))
	}

	gm := goldmark.New(
		goldmark.WithExtensions(exts...),
		goldmark.WithParserOptions(parserOpts...),
		goldmark.WithRendererOptions(rendererOpts...),
	)

	return &Renderer{md: gm, cfg: cfg, toc: toc}
}

// Render converts the Markdown source to HTML. When TOC is enabled a
// table-of-contents nav block is prepended to the output.
func (r *Renderer) Render(md string) (string, error) {
	if md == "" {
		return "", nil
	}
	var buf bytes.Buffer
	if err := r.md.Convert([]byte(md), &buf); err != nil {
		return "", fmt.Errorf("markdown: render: %w", err)
	}
	body := buf.String()
	if r.cfg.toc && r.toc != nil {
		tocHTML := r.toc.renderTOC()
		if tocHTML != "" {
			body = tocHTML + "\n" + body
		}
	}
	return body, nil
}

// ----------------------------------------------------------------------------
// TOC support
// ----------------------------------------------------------------------------

// tocTransformer is an AST transformer that walks heading nodes, assigns
// stable id attributes and records entries for the table of contents.
type tocTransformer struct {
	entries []tocEntry
}

type tocEntry struct {
	level int
	text  string
	id    string
}

func (t *tocTransformer) Transform(node *ast.Document, reader text.Reader, pc parser.Context) {
	t.entries = t.entries[:0]
	_ = ast.Walk(node, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		h, ok := n.(*ast.Heading)
		if !ok {
			return ast.WalkContinue, nil
		}
		textStr := strings.TrimSpace(string(h.Text(reader.Source())))
		id := slugify(textStr)
		// De-duplicate ids.
		id = t.uniqueID(id)
		h.SetAttribute([]byte("id"), []byte(id))
		t.entries = append(t.entries, tocEntry{level: h.Level, text: textStr, id: id})
		return ast.WalkContinue, nil
	})
}

func (t *tocTransformer) uniqueID(base string) string {
	if base == "" {
		base = "section"
	}
	seen := 0
	for _, e := range t.entries {
		if e.id == base {
			seen++
		}
	}
	if seen == 0 {
		return base
	}
	return fmt.Sprintf("%s-%d", base, seen)
}

func (t *tocTransformer) renderTOC() string {
	if len(t.entries) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(`<nav class="toc">`)
	b.WriteString("<ul>")
	for _, e := range t.entries {
		fmt.Fprintf(&b, `<li class="toc-level-%d"><a href="#%s">%s</a></li>`, e.level, e.id, escapeHTML(e.text))
	}
	b.WriteString("</ul></nav>")
	return b.String()
}

// slugify converts heading text into a URL-safe id.
func slugify(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	return out
}

func escapeHTML(s string) string {
	s = stdhtml.EscapeString(s)
	// html.EscapeString escapes ' to &#39; and " to &#34;. Restore single
	// quotes (the previous implementation did not escape them) and use
	// &quot; for double quotes for output compatibility.
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&#34;", "&quot;")
	return s
}

// ----------------------------------------------------------------------------
// Package-level convenience functions
// ----------------------------------------------------------------------------

// defaultRenderer is a Renderer with GFM enabled (the default configuration).
var defaultRenderer = NewRenderer()

// ToHTML converts Markdown to HTML using the default configuration (GFM
// enabled).
func ToHTML(md string) (string, error) {
	return defaultRenderer.Render(md)
}

// ToHTMLByte converts Markdown to HTML bytes using the default configuration.
func ToHTMLByte(md string) ([]byte, error) {
	out, err := defaultRenderer.Render(md)
	if err != nil {
		return nil, err
	}
	return []byte(out), nil
}

// MustToHTML converts Markdown to HTML and panics on error.
func MustToHTML(md string) string {
	out, err := ToHTML(md)
	if err != nil {
		panic(err)
	}
	return out
}
