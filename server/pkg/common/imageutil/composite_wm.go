// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Composite (image + text) watermarks. Renders a logo image and a text label
// onto a single watermark layer, then overlays the combined layer onto the
// base image. Supports horizontal (logo-left / logo-right) and vertical
// (logo-top / logo-bottom) layouts.

package imageutil

import (
	"image"
	"image/color"
	"image/draw"
)

// ──────────────────────────────────────────────
// Layout
// ──────────────────────────────────────────────

// Layout describes how the logo and text are arranged within a composite
// watermark.
type Layout int

const (
	// LayoutLogoLeftTextRight places the logo to the left of the text:
	//   [LOGO] Text
	LayoutLogoLeftTextRight Layout = iota
	// LayoutLogoRightTextLeft places the logo to the right of the text:
	//   Text [LOGO]
	LayoutLogoRightTextLeft
	// LayoutLogoTopTextBottom stacks the logo above the text:
	//   [LOGO]
	//   Text
	LayoutLogoTopTextBottom
	// LayoutLogoBottomTextTop stacks the text above the logo:
	//   Text
	//   [LOGO]
	LayoutLogoBottomTextTop
)

// ──────────────────────────────────────────────
// Composite watermark options
// ──────────────────────────────────────────────

// CompositeWatermarkOptions controls rendering of a combined logo + text
// watermark.
type CompositeWatermarkOptions struct {
	// Logo is the image (e.g. a brand mark) to place alongside the text.
	// Required — if nil, falls back to a pure text watermark.
	Logo image.Image
	// Text is the label drawn next to the logo. May be empty for a pure
	// image watermark.
	Text string
	// Font selects a registered font by name. Empty / "goregular" uses the
	// default built-in Go regular font.
	Font string
	// FontSize is the font size in points. Default 24.
	FontSize float64
	// TextColor is the text color. Default color.White.
	TextColor color.Color
	// Opacity in [0, 1] for the whole composite layer. Default 0.85.
	Opacity float64
	// Layout controls how logo and text are arranged. Default LogoLeftTextRight.
	Layout Layout
	// Spacing is the gap (in pixels) between the logo and the text. Default 8.
	Spacing int
	// Padding is the margin from the edge for positional variants. Default 16.
	Padding int
	// LogoHeight scales the logo so its height matches this many pixels.
	// If 0, the logo is used at its natural size. Useful for aligning the
	// logo with the text cap height.
	LogoHeight int
}

// withDefaults applies default values to zero fields.
func (o *CompositeWatermarkOptions) withDefaults() CompositeWatermarkOptions {
	out := *o
	if out.Font == "" {
		out.Font = FontGoRegular
	}
	if out.FontSize <= 0 {
		out.FontSize = 24
	}
	if out.TextColor == nil {
		out.TextColor = color.White
	}
	if out.Opacity <= 0 {
		out.Opacity = 0.85
	}
	if out.Opacity > 1 {
		out.Opacity = 1
	}
	if out.Spacing <= 0 {
		out.Spacing = 8
	}
	if out.Padding <= 0 {
		out.Padding = 16
	}
	return out
}

// ──────────────────────────────────────────────
// Layer builder
// ──────────────────────────────────────────────

// buildCompositeLayer renders the logo + text onto a single RGBA canvas
// according to the layout. Returns the layer and its dimensions.
func buildCompositeLayer(opts CompositeWatermarkOptions) image.Image {
	o := opts.withDefaults()

	// 1. Prepare the logo (optionally scaled).
	var logo image.Image
	if o.Logo != nil {
		logo = o.Logo
		if o.LogoHeight > 0 {
			lw, lh := Dimensions(logo)
			if lh > 0 && lh != o.LogoHeight {
				newW := lw * o.LogoHeight / lh
				if newW < 1 {
					newW = 1
				}
				logo = ResizeBilinear(logo, newW, o.LogoHeight)
			}
		}
	}

	// 2. Render the text (if any).
	var txt image.Image
	if o.Text != "" {
		txt = renderText(o.Text, o.Font, o.FontSize, o.TextColor)
	}

	// 3. Compute combined canvas size based on layout.
	var logoW, logoH, txtW, txtH int
	if logo != nil {
		logoW, logoH = Dimensions(logo)
	}
	if txt != nil {
		txtW, txtH = Dimensions(txt)
	}

	var canvasW, canvasH int
	switch o.Layout {
	case LayoutLogoLeftTextRight, LayoutLogoRightTextLeft:
		canvasW = logoW + txtW
		if txt != nil && logo != nil {
			canvasW += o.Spacing
		}
		canvasH = maxInt(logoH, txtH)
	case LayoutLogoTopTextBottom, LayoutLogoBottomTextTop:
		canvasH = logoH + txtH
		if txt != nil && logo != nil {
			canvasH += o.Spacing
		}
		canvasW = maxInt(logoW, txtW)
	default:
		canvasW = logoW + txtW
		canvasH = maxInt(logoH, txtH)
	}

	if canvasW < 1 {
		canvasW = 1
	}
	if canvasH < 1 {
		canvasH = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, canvasW, canvasH))

	// 4. Place logo and text according to layout (vertically centered within
	//    the row, horizontally centered within the column).
	switch o.Layout {
	case LayoutLogoLeftTextRight:
		if logo != nil {
			draw.Draw(dst, image.Rect(0, (canvasH-logoH)/2, logoW, (canvasH-logoH)/2+logoH), logo, image.Point{}, draw.Over)
		}
		if txt != nil {
			tx := logoW
			if logo != nil {
				tx += o.Spacing
			}
			draw.Draw(dst, image.Rect(tx, (canvasH-txtH)/2, tx+txtW, (canvasH-txtH)/2+txtH), txt, image.Point{}, draw.Over)
		}
	case LayoutLogoRightTextLeft:
		if txt != nil {
			draw.Draw(dst, image.Rect(0, (canvasH-txtH)/2, txtW, (canvasH-txtH)/2+txtH), txt, image.Point{}, draw.Over)
		}
		if logo != nil {
			lx := txtW
			if txt != nil {
				lx += o.Spacing
			}
			draw.Draw(dst, image.Rect(lx, (canvasH-logoH)/2, lx+logoW, (canvasH-logoH)/2+logoH), logo, image.Point{}, draw.Over)
		}
	case LayoutLogoTopTextBottom:
		if logo != nil {
			draw.Draw(dst, image.Rect((canvasW-logoW)/2, 0, (canvasW-logoW)/2+logoW, logoH), logo, image.Point{}, draw.Over)
		}
		if txt != nil {
			ty := logoH
			if logo != nil {
				ty += o.Spacing
			}
			draw.Draw(dst, image.Rect((canvasW-txtW)/2, ty, (canvasW-txtW)/2+txtW, ty+txtH), txt, image.Point{}, draw.Over)
		}
	case LayoutLogoBottomTextTop:
		if txt != nil {
			draw.Draw(dst, image.Rect((canvasW-txtW)/2, 0, (canvasW-txtW)/2+txtW, txtH), txt, image.Point{}, draw.Over)
		}
		if logo != nil {
			ly := txtH
			if txt != nil {
				ly += o.Spacing
			}
			draw.Draw(dst, image.Rect((canvasW-logoW)/2, ly, (canvasW-logoW)/2+logoW, ly+logoH), logo, image.Point{}, draw.Over)
		}
	}

	return dst
}

// maxInt returns the larger of two ints.
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ──────────────────────────────────────────────
// Composite watermark — positional
// ──────────────────────────────────────────────

// CompositeWatermark draws a logo + text watermark at (x, y) from the
// top-left of the combined layer's bounding box.
func CompositeWatermark(base image.Image, x, y int, opts CompositeWatermarkOptions) image.Image {
	o := opts.withDefaults()
	layer := buildCompositeLayer(o)
	return Watermark(base, layer, x, y, o.Opacity)
}

// CompositeWatermarkCenter draws a logo + text watermark centered on the
// base image.
func CompositeWatermarkCenter(base image.Image, opts CompositeWatermarkOptions) image.Image {
	o := opts.withDefaults()
	layer := buildCompositeLayer(o)
	bw, bh := Dimensions(base)
	lw, lh := Dimensions(layer)
	return Watermark(base, layer, (bw-lw)/2, (bh-lh)/2, o.Opacity)
}

// CompositeWatermarkBottomRight draws a logo + text watermark at the
// bottom-right corner with the given padding.
func CompositeWatermarkBottomRight(base image.Image, opts CompositeWatermarkOptions) image.Image {
	o := opts.withDefaults()
	layer := buildCompositeLayer(o)
	bw, bh := Dimensions(base)
	lw, lh := Dimensions(layer)
	return Watermark(base, layer, bw-lw-o.Padding, bh-lh-o.Padding, o.Opacity)
}

// CompositeWatermarkBottomLeft draws a logo + text watermark at the
// bottom-left corner with the given padding.
func CompositeWatermarkBottomLeft(base image.Image, opts CompositeWatermarkOptions) image.Image {
	o := opts.withDefaults()
	layer := buildCompositeLayer(o)
	_, bh := Dimensions(base)
	_, lh := Dimensions(layer)
	return Watermark(base, layer, o.Padding, bh-lh-o.Padding, o.Opacity)
}

// CompositeWatermarkTopRight draws a logo + text watermark at the top-right
// corner with the given padding.
func CompositeWatermarkTopRight(base image.Image, opts CompositeWatermarkOptions) image.Image {
	o := opts.withDefaults()
	layer := buildCompositeLayer(o)
	bw, _ := Dimensions(base)
	lw, _ := Dimensions(layer)
	return Watermark(base, layer, bw-lw-o.Padding, o.Padding, o.Opacity)
}

// CompositeWatermarkTopLeft draws a logo + text watermark at the top-left
// corner with the given padding.
func CompositeWatermarkTopLeft(base image.Image, opts CompositeWatermarkOptions) image.Image {
	o := opts.withDefaults()
	layer := buildCompositeLayer(o)
	return Watermark(base, layer, o.Padding, o.Padding, o.Opacity)
}
