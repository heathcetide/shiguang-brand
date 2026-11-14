// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Filter implementations: box blur (hand-rolled, trivial), gaussian blur and
// sharpen (via disintegration/imaging), edge detect (Sobel) and emboss
// (hand-rolled 3x3 convolution — no good library equivalent). All filters
// return a new image; the source is left unchanged.

package imageutil

import (
	"image"
	"image/color"
	"math"

	"github.com/disintegration/imaging"
)

// ──────────────────────────────────────────────
// Convolution helpers
// ──────────────────────────────────────────────

// convolve applies a 3x3 convolution kernel to the image.
// divisor scales the result; bias is added after division (useful for emboss).
func convolve(img image.Image, kernel [9]float64, divisor, bias float64) image.Image {
	w, h := Dimensions(img)
	src := toRGBA(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))

	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var r, g, b float64
			ki := 0
			for ky := -1; ky <= 1; ky++ {
				for kx := -1; kx <= 1; kx++ {
					sx := clampInt(x+kx, 0, w-1)
					sy := clampInt(y+ky, 0, h-1)
					c := src.RGBAAt(sx, sy)
					k := kernel[ki]
					r += float64(c.R) * k
					g += float64(c.G) * k
					b += float64(c.B) * k
					ki++
				}
			}
			if divisor != 0 && divisor != 1 {
				r /= divisor
				g /= divisor
				b /= divisor
			}
			r += bias
			g += bias
			b += bias
			dst.SetRGBA(x, y, color.RGBA{
				R: clamp8(int(r)),
				G: clamp8(int(g)),
				B: clamp8(int(b)),
				A: src.RGBAAt(x, y).A,
			})
		}
	}
	return dst
}

// clampInt clamps v to [lo, hi].
func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// toRGBA returns an RGBA copy of img if it isn't already *image.RGBA.
func toRGBA(img image.Image) *image.RGBA {
	if r, ok := img.(*image.RGBA); ok {
		return r
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(x, y, img.At(x, y))
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Box blur
// ──────────────────────────────────────────────

// BoxBlur applies a box (mean) blur with the given radius.
// radius=0 returns the original image; radius=1 uses a 3x3 kernel.
// Uses separable horizontal+vertical passes for O(n) performance.
func BoxBlur(img image.Image, radius int) image.Image {
	if radius <= 0 {
		return img
	}
	w, h := Dimensions(img)
	src := toRGBA(img)
	size := radius*2 + 1

	// Horizontal pass.
	tmp := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var r, g, b, a int
			for k := -radius; k <= radius; k++ {
				sx := clampInt(x+k, 0, w-1)
				c := src.RGBAAt(sx, y)
				r += int(c.R)
				g += int(c.G)
				b += int(c.B)
				a += int(c.A)
			}
			tmp.SetRGBA(x, y, color.RGBA{
				R: uint8(r / size),
				G: uint8(g / size),
				B: uint8(b / size),
				A: uint8(a / size),
			})
		}
	}

	// Vertical pass.
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var r, g, b, a int
			for k := -radius; k <= radius; k++ {
				sy := clampInt(y+k, 0, h-1)
				c := tmp.RGBAAt(x, sy)
				r += int(c.R)
				g += int(c.G)
				b += int(c.B)
				a += int(c.A)
			}
			dst.SetRGBA(x, y, color.RGBA{
				R: uint8(r / size),
				G: uint8(g / size),
				B: uint8(b / size),
				A: uint8(a / size),
			})
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Gaussian blur (via disintegration/imaging)
// ──────────────────────────────────────────────

// GaussianBlur applies a gaussian blur with the given sigma (standard
// deviation, in pixels). sigma <= 0 returns the original image.
//
// The radius parameter is kept for backward compatibility but ignored —
// imaging.Blur derives the kernel radius from sigma automatically. A
// reasonable mapping is sigma ≈ radius/2.
func GaussianBlur(img image.Image, radius int, sigma float64) image.Image {
	if sigma <= 0 {
		if radius <= 0 {
			return img
		}
		sigma = float64(radius) / 2
	}
	if sigma < 0.1 {
		sigma = 0.1
	}
	return imaging.Blur(img, sigma)
}

// ──────────────────────────────────────────────
// Sharpen (via disintegration/imaging — unsharp mask)
// ──────────────────────────────────────────────

// Sharpen applies an unsharp-mask sharpening filter via disintegration/imaging.
// amount is the sigma of the gaussian used for the unsharp mask; typical
// values are 0.5–2.0. amount <= 0 returns the original image.
func Sharpen(img image.Image, amount float64) image.Image {
	if amount <= 0 {
		return img
	}
	return imaging.Sharpen(img, amount)
}

// ──────────────────────────────────────────────
// Edge detect (Sobel)
// ──────────────────────────────────────────────

// EdgeDetect applies a Sobel edge-detection filter and returns a grayscale-ish
// image where edges are bright on a black background.
func EdgeDetect(img image.Image) image.Image {
	gray := Grayscale(img)
	gx := convolve(gray, [9]float64{
		-1, 0, 1,
		-2, 0, 2,
		-1, 0, 1,
	}, 1, 0)
	gy := convolve(gray, [9]float64{
		-1, -2, -1,
		0, 0, 0,
		1, 2, 1,
	}, 1, 0)

	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			cx := gx.At(x, y).(color.RGBA)
			cy := gy.At(x, y).(color.RGBA)
			mag := math.Sqrt(float64(cx.R)*float64(cx.R) + float64(cy.R)*float64(cy.R))
			v := clamp8(int(mag))
			dst.SetRGBA(x, y, color.RGBA{R: v, G: v, B: v, A: 255})
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Emboss
// ──────────────────────────────────────────────

// Emboss applies an emboss effect, giving the image a 3D relief appearance.
func Emboss(img image.Image) image.Image {
	// Classic emboss kernel with 128 bias to keep mid-tones visible.
	return convolve(img, [9]float64{
		-2, -1, 0,
		-1, 1, 1,
		0, 1, 2,
	}, 1, 128)
}
