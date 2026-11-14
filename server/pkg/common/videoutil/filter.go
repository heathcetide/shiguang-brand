// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package videoutil

import (
	"fmt"
	"strings"
)

// ──────────────────────────────────────────────
// Filter graph builder
// ──────────────────────────────────────────────

// FilterGraph builds a complex FFmpeg filter graph string.
// It is used for operations that require multiple inputs (e.g. overlaying
// a watermark image onto a video).
type FilterGraph struct {
	chains []string
}

// NewFilterGraph creates a new empty filter graph.
func NewFilterGraph() *FilterGraph {
	return &FilterGraph{}
}

// String returns the complete filter graph string for -filter_complex.
func (g *FilterGraph) String() string {
	return strings.Join(g.chains, ";")
}

// AddChain adds a filter chain (a series of filters separated by commas).
// Each chain can have input/output labels via [label] syntax.
func (g *FilterGraph) AddChain(chain string) *FilterGraph {
	g.chains = append(g.chains, chain)
	return g
}

// ──────────────────────────────────────────────
// Overlay helpers
// ──────────────────────────────────────────────

// OverlayPosition returns the x:y coordinates for placing an overlay
// at the given position with optional margin.
func OverlayPosition(pos Position, videoW, videoH, overlayW, overlayH, margin int) (x, y int) {
	switch pos {
	case PositionTopLeft:
		return margin, margin
	case PositionTopRight:
		return videoW - overlayW - margin, margin
	case PositionBottomLeft:
		return margin, videoH - overlayH - margin
	case PositionBottomRight:
		return videoW - overlayW - margin, videoH - overlayH - margin
	case PositionCenter:
		return (videoW - overlayW) / 2, (videoH - overlayH) / 2
	default:
		return margin, margin
	}
}

// OverlayExpr returns FFmpeg overlay=x:y expressions for the given
// position. Uses W/H (overlay width/height) and w/h (main width/height)
// variables available in the overlay filter.
func OverlayExpr(pos Position, margin int) (xExpr, yExpr string) {
	m := fmt.Sprintf("%d", margin)
	switch pos {
	case PositionTopLeft:
		return m, m
	case PositionTopRight:
		return fmt.Sprintf("W-w-%d", margin), m
	case PositionBottomLeft:
		return m, fmt.Sprintf("H-h-%d", margin)
	case PositionBottomRight:
		return fmt.Sprintf("W-w-%d", margin), fmt.Sprintf("H-h-%d", margin)
	case PositionCenter:
		return "(W-w)/2", "(H-h)/2"
	default:
		return m, m
	}
}

// ──────────────────────────────────────────────
// Watermark filter graph builder
// ──────────────────────────────────────────────

// WatermarkOptions configures how a watermark is applied.
type WatermarkOptions struct {
	Position Position // corner/center (default: bottom-right)
	Margin   int      // pixel margin from edge (default: 10)
	Scale    float64  // scale factor relative to video width (0 = no scaling, default: 0)
	Opacity  float64  // 0.0-1.0, 1 = fully opaque (default: 1)
}

// DefaultWatermarkOptions returns sensible defaults.
func DefaultWatermarkOptions() WatermarkOptions {
	return WatermarkOptions{
		Position: PositionBottomRight,
		Margin:   10,
		Opacity:  1,
	}
}

// BuildImageWatermarkFilter builds the filter_complex string for
// overlaying an image watermark onto a video.
//
// Input 0 is the main video, input 1 is the watermark image.
// The output label is "[out]".
func BuildImageWatermarkFilter(opts WatermarkOptions) string {
	xExpr, yExpr := OverlayExpr(opts.Position, opts.Margin)

	// Build the watermark processing chain. Always output [wm] label.
	var filters []string
	if opts.Scale > 0 {
		filters = append(filters, fmt.Sprintf("scale=iw*%g:-1", opts.Scale))
	}
	if opts.Opacity > 0 && opts.Opacity < 1 {
		filters = append(filters, "format=rgba")
		filters = append(filters, fmt.Sprintf("colorchannelmixer=aa=%g", opts.Opacity))
	}
	// If no filters, use null to pass through.
	if len(filters) == 0 {
		filters = append(filters, "null")
	}
	chain := "[1:v]" + strings.Join(filters, ",") + "[wm]"

	return fmt.Sprintf("%s;[0:v][wm]overlay=%s:%s[out]", chain, xExpr, yExpr)
}

// BuildTextWatermarkFilter builds the filter_complex string for
// overlaying text onto a video using the drawtext filter.
//
// Parameters:
//   - text: the text to display
//   - fontFile: path to a .ttf/.otf font file (may be empty for default font)
//   - fontSize: font size in pixels (default: 24)
//   - color: font color (default: "white")
//   - opts: position, margin, opacity
func BuildTextWatermarkFilter(text, fontFile string, fontSize int, color string, opts WatermarkOptions) string {
	if fontSize <= 0 {
		fontSize = 24
	}
	if color == "" {
		color = "white"
	}

	xExpr, yExpr := OverlayExpr(opts.Position, opts.Margin)

	// Escape special characters in text for FFmpeg filter syntax.
	escapedText := escapeDrawText(text)

	// Build drawtext filter.
	parts := []string{
		fmt.Sprintf("drawtext=text='%s'", escapedText),
		fmt.Sprintf("fontsize=%d", fontSize),
		fmt.Sprintf("fontcolor=%s", color),
		fmt.Sprintf("x=%s", xExpr),
		fmt.Sprintf("y=%s", yExpr),
	}
	if fontFile != "" {
		parts = append(parts, fmt.Sprintf("fontfile=%s", escapeFilterPath(fontFile)))
	}
	if opts.Opacity > 0 && opts.Opacity < 1 {
		parts = append(parts, fmt.Sprintf("alpha=%g", opts.Opacity))
	}
	// Add a subtle shadow for readability.
	parts = append(parts, "shadowcolor=black@0.5", "shadowx=1", "shadowy=1")

	return fmt.Sprintf("[0:v]%s[out]", strings.Join(parts, ":"))
}

// escapeDrawText escapes text for use in FFmpeg drawtext filter.
func escapeDrawText(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "'", "\\'")
	s = strings.ReplaceAll(s, ":", "\\:")
	s = strings.ReplaceAll(s, "%", "\\%")
	return s
}

// escapeFilterPath escapes a file path for use in FFmpeg filter syntax.
func escapeFilterPath(p string) string {
	return strings.ReplaceAll(p, ":", "\\:")
}
