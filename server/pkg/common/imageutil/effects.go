// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Special effects: vignette, noise/grain, and pixelation. All are
// per-pixel operations using only the Go standard library.

package imageutil

import (
	"image"
	"image/color"
	"math"
	"math/rand"
)

// ──────────────────────────────────────────────
// Vignette
// ──────────────────────────────────────────────

// Vignette darkens the corners of the image with a radial gradient.
// strength in [0, 1] controls how dark the corners get (0 = no effect,
// 1 = fully black at the farthest corner). size in [0, 1] controls the
// falloff: 0 = sharp transition at the very edge, 1 = vignette starts
// from the center. A typical value is 0.5.
func Vignette(img image.Image, strength, size float64) image.Image {
	if strength <= 0 {
		return img
	}
	if strength > 1 {
		strength = 1
	}
	if size < 0 {
		size = 0
	}
	if size > 1 {
		size = 1
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	cx, cy := float64(w-1)/2, float64(h-1)/2
	maxR := math.Sqrt(cx*cx + cy*cy)
	if maxR == 0 {
		maxR = 1
	}
	// Inner radius (no darkening) and outer radius (full darkening).
	inner := maxR * size
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			dx := float64(x) - cx
			dy := float64(y) - cy
			dist := math.Sqrt(dx*dx + dy*dy)
			var factor float64
			if dist <= inner {
				factor = 0
			} else {
				factor = (dist - inner) / (maxR - inner)
				if factor > 1 {
					factor = 1
				}
			}
			darken := 1 - strength*factor
			dst.SetRGBA(x, y, color.RGBA{
				R: clamp8(int(float64(r/256) * darken)),
				G: clamp8(int(float64(g/256) * darken)),
				B: clamp8(int(float64(b/256) * darken)),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Noise / grain
// ──────────────────────────────────────────────

// AddNoise adds random noise to each pixel, simulating film grain.
// amount in [0, 255] is the maximum per-channel perturbation.
// monochrome=true applies the same delta to R, G, B (grayscale noise);
// false applies independent deltas per channel (color noise).
// A nil rng uses a default math/rand source.
func AddNoise(img image.Image, amount int, monochrome bool, rng *rand.Rand) image.Image {
	if amount <= 0 {
		return img
	}
	if amount > 255 {
		amount = 255
	}
	if rng == nil {
		rng = rand.New(rand.NewSource(int64(amount))) // deterministic per amount
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			if monochrome {
				delta := int(rng.Intn(2*amount+1) - amount)
				dst.SetRGBA(x, y, color.RGBA{
					R: clamp8(int(r/256) + delta),
					G: clamp8(int(g/256) + delta),
					B: clamp8(int(b/256) + delta),
					A: uint8(a / 256),
				})
			} else {
				dr := int(rng.Intn(2*amount+1) - amount)
				dg := int(rng.Intn(2*amount+1) - amount)
				db := int(rng.Intn(2*amount+1) - amount)
				dst.SetRGBA(x, y, color.RGBA{
					R: clamp8(int(r/256) + dr),
					G: clamp8(int(g/256) + dg),
					B: clamp8(int(b/256) + db),
					A: uint8(a / 256),
				})
			}
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Pixelate (mosaic)
// ──────────────────────────────────────────────

// Pixelate block-averages the image into blocks of the given size,
// producing a mosaic/pixelation effect. blockSize is the side length of
// each block in pixels; values <= 1 return the original image.
func Pixelate(img image.Image, blockSize int) image.Image {
	if blockSize <= 1 {
		return img
	}
	w, h := Dimensions(img)
	src := toRGBA(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for by := 0; by < h; by += blockSize {
		for bx := 0; bx < w; bx += blockSize {
			// Compute average color of this block.
			var r, g, b, a, count int
			byMax := by + blockSize
			if byMax > h {
				byMax = h
			}
			bxMax := bx + blockSize
			if bxMax > w {
				bxMax = w
			}
			for y := by; y < byMax; y++ {
				for x := bx; x < bxMax; x++ {
					c := src.RGBAAt(x, y)
					r += int(c.R)
					g += int(c.G)
					b += int(c.B)
					a += int(c.A)
					count++
				}
			}
			if count == 0 {
				continue
			}
			avg := color.RGBA{
				R: uint8(r / count),
				G: uint8(g / count),
				B: uint8(b / count),
				A: uint8(a / count),
			}
			// Fill the block with the average color.
			for y := by; y < byMax; y++ {
				for x := bx; x < bxMax; x++ {
					dst.SetRGBA(x, y, avg)
				}
			}
		}
	}
	return dst
}
