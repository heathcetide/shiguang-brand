// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package sanitize provides HTML/XSS filtering helpers built on top of
// bluemonday. It offers several canned policies ranging from a plain-text
// strict mode to a permissive UGC mode that keeps a safe subset of HTML
// tags, plus utilities for escaping, stripping tags and sanitizing URLs.
//
// Basic usage:
//
//	// Remove dangerous tags but keep safe ones
//	safe := sanitize.Clean(`<a href="https://x.com">ok</a><script>x</script>`)
//
//	// UGC mode: allow b/i/em/strong/a/p/br/ul/ol/li/code/pre ...
//	body := sanitize.CleanUGC(userContent)
//
//	// Strict mode: plain text only
//	text := sanitize.CleanStrict(`<b>hi</b>`) // "hi"
//
//	// URL safety
//	if sanitize.IsSafeURL(u) {
//	    u = sanitize.SanitizeURL(u)
//	}
package sanitize

import (
	"html"
	"net/url"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

// dangerousSchemes matches URL schemes that can execute code or load
// arbitrary content when followed by a browser.
var dangerousSchemes = regexp.MustCompile(`(?i)^(javascript|data|vbscript|file|about):`)

// scriptStyleIframe matches <script>, <style> and <iframe> blocks so that
// StripTags can drop their (potentially executable) content entirely
// instead of leaving the inner text behind. Go's RE2 engine does not support
// backreferences, so each tag is matched with its own non-greedy pattern.
var scriptStyleIframe = regexp.MustCompile(`(?is)(?:<script[^>]*>.*?</script\s*>|<style[^>]*>.*?</style\s*>|<iframe[^>]*>.*?</iframe\s*>)`)

// anyTag matches any HTML tag for StripTags fallback.
var anyTag = regexp.MustCompile(`<[^>]*>`)

// onAttr matches inline event handler attributes such as onclick, onload.
var onAttr = regexp.MustCompile(`(?i)\son\w+\s*=`)

// ----------------------------------------------------------------------------
// Policies
// ----------------------------------------------------------------------------

// UGCPolicy returns the bluemonday policy used by CleanUGC. It allows a safe
// subset of tags commonly used in user generated content (b, i, em, strong,
// a, p, br, ul, ol, li, code, pre, blockquote, h1-h6, hr, img, span, div,
// table, thead, tbody, tr, th, td) while stripping script/style/iframe and
// all on* event handler attributes. The returned policy can be further
// customized before use.
func UGCPolicy() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()

	// Explicitly ensure commonly expected inline tags are allowed.
	p.AllowElements("b", "i", "em", "strong", "code", "pre", "span", "div")

	// Allow class attribute on a small set of structural tags for styling.
	p.AllowAttrs("class").OnElements("div", "span", "p", "code", "pre")

	// Allow title on links.
	p.AllowAttrs("title").OnElements("a")

	return p
}

// strictPolicy strips every HTML tag, leaving only escaped text.
func strictPolicy() *bluemonday.Policy {
	return bluemonday.StrictPolicy()
}

// defaultPolicy is a relaxed policy that keeps safe formatting tags but
// removes scripts, event handlers and dangerous URLs. bluemonday is
// allowlist-based, so any element/attribute not explicitly allowed is
// automatically dropped (including script/style/iframe and on* attrs).
func defaultPolicy() *bluemonday.Policy {
	p := bluemonday.NewPolicy()

	p.AllowStandardAttributes()
	p.AllowStandardURLs()

	p.AllowElements(
		"a", "b", "i", "em", "strong", "p", "br", "hr",
		"ul", "ol", "li", "code", "pre", "blockquote",
		"h1", "h2", "h3", "h4", "h5", "h6",
		"span", "div", "img",
		"table", "thead", "tbody", "tr", "th", "td",
	)

	p.AllowAttrs("href").OnElements("a")
	p.AllowAttrs("src").OnElements("img")
	p.AllowAttrs("alt", "title").OnElements("a", "img")
	p.AllowAttrs("class").OnElements("div", "span", "p", "code", "pre")

	return p
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

// Clean performs a basic HTML cleanup: it keeps safe formatting tags and
// removes dangerous ones (script/style/iframe), event handler attributes
// (on*) and javascript:/data: URLs.
func Clean(s string) string {
	if s == "" {
		return ""
	}
	// Drop script/style/iframe blocks before running the policy so their
	// inner text is not left behind.
	s = scriptStyleIframe.ReplaceAllString(s, "")
	s = onAttr.ReplaceAllString(s, " ")
	return defaultPolicy().Sanitize(s)
}

// CleanStrict removes every HTML tag and returns plain, escaped text.
func CleanStrict(s string) string {
	if s == "" {
		return ""
	}
	return strictPolicy().Sanitize(s)
}

// CleanUGC sanitizes user generated content using UGCPolicy. It keeps a safe
// subset of tags (b/i/em/strong/a/p/br/ul/ol/li/code/pre/...) and removes
// script/style/iframe, on* attributes and dangerous URLs.
func CleanUGC(s string) string {
	if s == "" {
		return ""
	}
	s = scriptStyleIframe.ReplaceAllString(s, "")
	s = onAttr.ReplaceAllString(s, " ")
	return UGCPolicy().Sanitize(s)
}

// EscapeHTML escapes special HTML characters (<, >, &, ", ') to their
// corresponding entities.
func EscapeHTML(s string) string {
	if s == "" {
		return ""
	}
	return html.EscapeString(s)
}

// StripTags removes all HTML tags but keeps the inner text content. The
// contents of <script>, <style> and <iframe> blocks are dropped entirely.
func StripTags(s string) string {
	if s == "" {
		return ""
	}
	s = scriptStyleIframe.ReplaceAllString(s, "")
	s = anyTag.ReplaceAllString(s, "")
	return strings.TrimSpace(s)
}

// SanitizeURL returns the URL with dangerous schemes (javascript:, data:,
// vbscript:, file:, about:) removed. If the URL is unsafe an empty string is
// returned. Relative URLs and http(s) URLs are returned unchanged.
func SanitizeURL(s string) string {
	if s == "" {
		return ""
	}
	trimmed := strings.TrimSpace(s)
	if dangerousSchemes.MatchString(trimmed) {
		return ""
	}
	// Validate parseable URLs; allow relative references.
	if u, err := url.Parse(trimmed); err == nil {
		if u.IsAbs() {
			scheme := strings.ToLower(u.Scheme)
			if scheme != "http" && scheme != "https" && scheme != "mailto" && scheme != "tel" && scheme != "ftp" {
				return ""
			}
		}
		return trimmed
	}
	return ""
}

// IsSafeURL reports whether the URL uses a safe scheme (http, https, mailto,
// tel, ftp) or is a relative reference. javascript:, data:, vbscript:, file:
// and about: URLs are considered unsafe.
func IsSafeURL(s string) bool {
	if s == "" {
		return false
	}
	trimmed := strings.TrimSpace(s)
	if dangerousSchemes.MatchString(trimmed) {
		return false
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return false
	}
	if !u.IsAbs() {
		return true
	}
	scheme := strings.ToLower(u.Scheme)
	switch scheme {
	case "http", "https", "mailto", "tel", "ftp":
		return true
	default:
		return false
	}
}

// CleanMarkdown sanitizes HTML embedded inside Markdown source while
// preserving Markdown syntax. Inline HTML blocks/tags are passed through
// CleanUGC; Markdown markup (#, *, >, [], etc.) is left untouched.
func CleanMarkdown(s string) string {
	if s == "" {
		return ""
	}
	// Only HTML fragments need cleaning; run the UGC policy which keeps
	// formatting tags useful inside Markdown (code, pre, a, ...).
	s = scriptStyleIframe.ReplaceAllString(s, "")
	s = onAttr.ReplaceAllString(s, " ")
	return UGCPolicy().Sanitize(s)
}
