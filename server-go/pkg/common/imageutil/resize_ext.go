// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Extended resize operations: fit-with-padding (letterbox). Uses only the Go
// standard library.

package imageutil

import (
	"image"
	"image/color"
	"image/draw"
)

// ──────────────────────────────────────────────
// Resize with padding (letterbox / fit)
// ──────────────────────────────────────────────

// ResizeWithPadding resizes the image to fit within targetW x targetH while
// preserving aspect ratio, then centers it on a solid background canvas of
// exactly targetW x targetH (letterbox / "object-fit: contain").
//
// If the source is smaller than the target in both dimensions, it is still
// upscaled to fit (no upscaling-skip). For a no-upscale variant, see
// ThumbnailWithPadding.
//
// bg is the padding color (e.g. color.Black or color.White).
func ResizeWithPadding(img image.Image, targetW, targetH int, bg color.Color) image.Image {
	if targetW <= 0 || targetH <= 0 {
		return img
	}
	srcW, srcH := Dimensions(img)
	if srcW == 0 || srcH == 0 {
		return img
	}

	// Compute scaled size that fits inside the target box.
	ratio := minFloat(float64(targetW)/float64(srcW), float64(targetH)/float64(srcH))
	scaledW := int(float64(srcW) * ratio)
	scaledH := int(float64(srcH) * ratio)
	if scaledW < 1 {
		scaledW = 1
	}
	if scaledH < 1 {
		scaledH = 1
	}

	scaled := ResizeBilinear(img, scaledW, scaledH)
	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)
	offX := (targetW - scaledW) / 2
	offY := (targetH - scaledH) / 2
	draw.Draw(dst, image.Rect(offX, offY, offX+scaledW, offY+scaledH), scaled, image.Point{}, draw.Src)
	return dst
}

// ThumbnailWithPadding is like ResizeWithPadding but never upscales: if the
// source already fits within targetW x targetH, it is centered as-is on the
// padding canvas.
func ThumbnailWithPadding(img image.Image, targetW, targetH int, bg color.Color) image.Image {
	if targetW <= 0 || targetH <= 0 {
		return img
	}
	srcW, srcH := Dimensions(img)
	if srcW == 0 || srcH == 0 {
		return img
	}

	scaledW, scaledH := srcW, srcH
	if srcW > targetW || srcH > targetH {
		ratio := minFloat(float64(targetW)/float64(srcW), float64(targetH)/float64(srcH))
		scaledW = int(float64(srcW) * ratio)
		scaledH = int(float64(srcH) * ratio)
		if scaledW < 1 {
			scaledW = 1
		}
		if scaledH < 1 {
			scaledH = 1
		}
	}

	var scaled image.Image = img
	if scaledW != srcW || scaledH != srcH {
		scaled = ResizeBilinear(img, scaledW, scaledH)
	}
	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)
	offX := (targetW - scaledW) / 2
	offY := (targetH - scaledH) / 2
	draw.Draw(dst, image.Rect(offX, offY, offX+scaledW, offY+scaledH), scaled, image.Point{}, draw.Src)
	return dst
}

// minFloat returns the smaller of two floats.
func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
