// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Hex color parsing utilities. ParseHexColor converts CSS-style hex color
// strings (#rgb, #rgba, #rrggbb, #rrggbbaa) into color.RGBA, and
// FormatHexColor provides the reverse conversion. No external dependencies.

package imageutil

import (
	"fmt"
	"image/color"
	"strconv"
	"strings"
)

// ParseHexColor parses a hex color string into a color.RGBA.
// Supported formats (with or without leading '#'):
//
//   - "#rgb"       → e.g. "#f80"  = #ff8800, alpha=255
//   - "#rgba"      → e.g. "#f80a" = #ff8800aa
//   - "#rrggbb"    → e.g. "#ff8800", alpha=255
//   - "#rrggbbaa"  → e.g. "#ff8800aa"
//
// Uppercase and lowercase hex digits are accepted. The leading '#' is
// optional.
func ParseHexColor(s string) (color.RGBA, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "#")
	if len(s) == 0 {
		return color.RGBA{}, fmt.Errorf("imageutil: empty hex color")
	}
	switch len(s) {
	case 3:
		return parseHexShort(s, false)
	case 4:
		return parseHexShort(s, true)
	case 6:
		return parseHexLong(s, false)
	case 8:
		return parseHexLong(s, true)
	default:
		return color.RGBA{}, fmt.Errorf("imageutil: invalid hex color length %d (expected 3, 4, 6, or 8)", len(s))
	}
}

// FormatHexColor converts a color.Color to a "#rrggbb" hex string (alpha
// omitted when fully opaque) or "#rrggbbaa" when alpha < 255.
func FormatHexColor(c color.Color) string {
	r, g, b, a := c.RGBA()
	r8, g8, b8, a8 := uint8(r/256), uint8(g/256), uint8(b/256), uint8(a/256)
	if a8 == 255 {
		return fmt.Sprintf("#%02x%02x%02x", r8, g8, b8)
	}
	return fmt.Sprintf("#%02x%02x%02x%02x", r8, g8, b8, a8)
}

// MustParseHexColor is like ParseHexColor but panics on error. Useful for
// package-level color constants.
func MustParseHexColor(s string) color.RGBA {
	c, err := ParseHexColor(s)
	if err != nil {
		panic(err)
	}
	return c
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

// parseHexShort handles 3 (#rgb) or 4 (#rgba) digit forms by doubling
// each digit, e.g. "f80" → "ff8800".
func parseHexShort(s string, hasAlpha bool) (color.RGBA, error) {
	expand := func(b byte) (uint8, error) {
		v, err := strconv.ParseUint(string([]byte{b, b}), 16, 8)
		return uint8(v), err
	}
	r, err := expand(s[0])
	if err != nil {
		return color.RGBA{}, fmt.Errorf("imageutil: invalid hex digit %q", s[0])
	}
	g, err := expand(s[1])
	if err != nil {
		return color.RGBA{}, fmt.Errorf("imageutil: invalid hex digit %q", s[1])
	}
	b, err := expand(s[2])
	if err != nil {
		return color.RGBA{}, fmt.Errorf("imageutil: invalid hex digit %q", s[2])
	}
	a := uint8(255)
	if hasAlpha {
		a, err = expand(s[3])
		if err != nil {
			return color.RGBA{}, fmt.Errorf("imageutil: invalid hex digit %q", s[3])
		}
	}
	return color.RGBA{R: r, G: g, B: b, A: a}, nil
}

// parseHexLong handles 6 (#rrggbb) or 8 (#rrggbbaa) digit forms.
func parseHexLong(s string, hasAlpha bool) (color.RGBA, error) {
	r, err := strconv.ParseUint(s[0:2], 16, 8)
	if err != nil {
		return color.RGBA{}, fmt.Errorf("imageutil: invalid hex byte %q", s[0:2])
	}
	g, err := strconv.ParseUint(s[2:4], 16, 8)
	if err != nil {
		return color.RGBA{}, fmt.Errorf("imageutil: invalid hex byte %q", s[2:4])
	}
	b, err := strconv.ParseUint(s[4:6], 16, 8)
	if err != nil {
		return color.RGBA{}, fmt.Errorf("imageutil: invalid hex byte %q", s[4:6])
	}
	a := uint64(255)
	if hasAlpha {
		a, err = strconv.ParseUint(s[6:8], 16, 8)
		if err != nil {
			return color.RGBA{}, fmt.Errorf("imageutil: invalid hex byte %q", s[6:8])
		}
	}
	return color.RGBA{R: uint8(r), G: uint8(g), B: uint8(b), A: uint8(a)}, nil
}
