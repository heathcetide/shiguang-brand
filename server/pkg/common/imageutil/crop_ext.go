// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Extended crop operations: anchor-based 9-grid cropping, aspect-ratio crop,
// circular crop (transparent corners), and rounded-corner crop. Uses only the
// Go standard library.

package imageutil

import (
	"image"
	"image/color"
	"image/draw"
	"math"
)

// ──────────────────────────────────────────────
// Anchor (9-grid)
// ──────────────────────────────────────────────

// Anchor selects which of 9 regions of the source to keep when cropping to a
// target aspect ratio. Layout:
//
//	TopLeft     TopCenter     TopRight
//	MiddleLeft  MiddleCenter  MiddleRight
//	BottomLeft  BottomCenter  BottomRight
type Anchor int

const (
	AnchorTopLeft Anchor = iota
	AnchorTopCenter
	AnchorTopRight
	AnchorMiddleLeft
	AnchorMiddleCenter
	AnchorBottomLeft
	AnchorBottomCenter
	AnchorBottomRight
)

// anchorOffset returns the (x, y) origin for a crop window of size (cw, ch)
// within an image of size (w, h) according to the anchor.
func anchorOffset(a Anchor, w, h, cw, ch int) (int, int) {
	switch a {
	case AnchorTopLeft:
		return 0, 0
	case AnchorTopCenter:
		return (w - cw) / 2, 0
	case AnchorTopRight:
		return w - cw, 0
	case AnchorMiddleLeft:
		return 0, (h - ch) / 2
	case AnchorMiddleCenter:
		return (w - cw) / 2, (h - ch) / 2
	case AnchorBottomLeft:
		return 0, h - ch
	case AnchorBottomCenter:
		return (w - cw) / 2, h - ch
	case AnchorBottomRight:
		return w - cw, h - ch
	default:
		return (w - cw) / 2, (h - ch) / 2
	}
}

// CropAspectRatio crops the source to the given aspect ratio (ratioW:ratioH)
// using the specified anchor. The result keeps the source resolution (no
// resize). If the source already matches the ratio, it is returned unchanged.
func CropAspectRatio(img image.Image, ratioW, ratioH int, anchor Anchor) image.Image {
	if ratioW <= 0 || ratioH <= 0 {
		return img
	}
	srcW, srcH := Dimensions(img)
	srcRatio := float64(srcW) / float64(srcH)
	targetRatio := float64(ratioW) / float64(ratioH)

	var cw, ch int
	if srcRatio > targetRatio {
		// Source is wider: trim width.
		ch = srcH
		cw = int(float64(srcH) * targetRatio)
	} else {
		cw = srcW
		ch = int(float64(srcW) / targetRatio)
	}
	if cw > srcW {
		cw = srcW
	}
	if ch > srcH {
		ch = srcH
	}
	if cw == srcW && ch == srcH {
		return img
	}
	x, y := anchorOffset(anchor, srcW, srcH, cw, ch)
	return Crop(img, image.Rect(x, y, x+cw, y+ch))
}

// CropAspectRatioResize crops to the given aspect ratio using the anchor,
// then resizes the result to exactly targetW x targetH (bilinear).
func CropAspectRatioResize(img image.Image, ratioW, ratioH, targetW, targetH int, anchor Anchor) image.Image {
	cropped := CropAspectRatio(img, ratioW, ratioH, anchor)
	return ResizeBilinear(cropped, targetW, targetH)
}

// ──────────────────────────────────────────────
// Circular crop
// ──────────────────────────────────────────────

// CropCircle crops the image to a circle inscribed in the smaller dimension,
// centered. Pixels outside the circle are fully transparent. The result is
// RGBA and has the same dimensions as the source.
func CropCircle(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	cx, cy := float64(w)/2, float64(h)/2
	r := math.Min(cx, cy)
	r2 := r * r

	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dx := float64(x) + 0.5 - cx
			dy := float64(y) + 0.5 - cy
			d2 := dx*dx + dy*dy
			if d2 <= r2 {
				dst.Set(x, y, img.At(x, y))
			} else {
				dst.Set(x, y, color.RGBA{0, 0, 0, 0})
			}
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Rounded corners
// ──────────────────────────────────────────────

// RoundCorners rounds the corners of the image with the given radius.
// Areas outside the rounded rectangle are transparent. The result is RGBA
// with the same dimensions as the source.
func RoundCorners(img image.Image, radius int) image.Image {
	w, h := Dimensions(img)
	if radius <= 0 {
		return img
	}
	// Clamp radius to half the smaller dimension.
	maxR := w / 2
	if h/2 < maxR {
		maxR = h / 2
	}
	if radius > maxR {
		radius = maxR
	}

	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), img, image.Point{}, draw.Src)

	rf := float64(radius)
	r2 := rf * rf
	corners := [4][2]float64{
		{rf, rf},                                   // top-left
		{float64(w) - 1 - rf, rf},                  // top-right
		{rf, float64(h) - 1 - rf},                  // bottom-left
		{float64(w) - 1 - rf, float64(h) - 1 - rf}, // bottom-right
	}

	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			inside := true
			// Check each corner region only if the pixel is in that corner's quadrant.
			if x < radius && y < radius {
				inside = inCircle(float64(x)+0.5, float64(y)+0.5, corners[0], r2)
			} else if x >= w-radius && y < radius {
				inside = inCircle(float64(x)+0.5, float64(y)+0.5, corners[1], r2)
			} else if x < radius && y >= h-radius {
				inside = inCircle(float64(x)+0.5, float64(y)+0.5, corners[2], r2)
			} else if x >= w-radius && y >= h-radius {
				inside = inCircle(float64(x)+0.5, float64(y)+0.5, corners[3], r2)
			}
			if !inside {
				dst.SetRGBA(x, y, color.RGBA{0, 0, 0, 0})
			}
		}
	}
	return dst
}

// inCircle reports whether (px, py) is inside the circle centered at (cx, cy)
// with squared radius r2.
func inCircle(px, py float64, center [2]float64, r2 float64) bool {
	dx := px - center[0]
	dy := py - center[1]
	return dx*dx+dy*dy <= r2
}
