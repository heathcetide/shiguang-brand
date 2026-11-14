// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Cinematic color filters: vintage, cool, and warm looks. These are
// per-pixel operations implemented with the Go standard library only.
// Each filter composes a channel-matrix multiply with a subtle vignette
// and contrast/saturation tweak, so they feel like "looks" rather than
// raw channel shifts (which AdjustTemperature already provides).

package imageutil

import (
	"image"
	"image/color"
	"math"
)

// ──────────────────────────────────────────────
// Vintage
// ──────────────────────────────────────────────

// Vintage applies a faded, warm-toned vintage look: lifted blacks,
// reduced contrast, shifted toward amber/sepia, with a subtle vignette.
// strength in [0, 1] controls how strong the effect is (0 = no change).
func Vintage(img image.Image, strength float64) image.Image {
	if strength <= 0 {
		return img
	}
	if strength > 1 {
		strength = 1
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	cx, cy := float64(w-1)/2, float64(h-1)/2
	maxR := math.Sqrt(cx*cx + cy*cy)
	if maxR == 0 {
		maxR = 1
	}
	inv := 1 - strength
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			r8, g8, b8 := float64(r/256), float64(g/256), float64(b/256)

			// Channel mix: warm amber tone.
			nr := 0.299*r8 + 0.577*g8 + 0.114*b8 // luminance
			ng := 0.250*r8 + 0.620*g8 + 0.130*b8
			nb := 0.180*r8 + 0.380*g8 + 0.440*b8

			// Lift blacks, reduce contrast.
			nr = (nr-128)*0.85 + 128 + 12
			ng = (ng-128)*0.85 + 128 + 8
			nb = (nb-128)*0.85 + 128 + 4

			// Vignette.
			dx := float64(x) - cx
			dy := float64(y) - cy
			dist := math.Sqrt(dx*dx + dy*dy)
			vig := 1 - 0.35*(dist/maxR)
			if vig < 0.6 {
				vig = 0.6
			}
			nr *= vig
			ng *= vig
			nb *= vig

			// Blend with original by strength.
			dst.SetRGBA(x, y, color.RGBA{
				R: clamp8(int(r8*inv + nr*strength)),
				G: clamp8(int(g8*inv + ng*strength)),
				B: clamp8(int(b8*inv + nb*strength)),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Cool
// ──────────────────────────────────────────────

// Cool applies a cool-toned look: shifted toward blue/cyan, slightly
// desaturated, with a subtle contrast boost. strength in [0, 1].
func Cool(img image.Image, strength float64) image.Image {
	if strength <= 0 {
		return img
	}
	if strength > 1 {
		strength = 1
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	inv := 1 - strength
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			r8, g8, b8 := float64(r/256), float64(g/256), float64(b/256)

			// Shift toward cool: reduce red, boost blue, slight cyan in greens.
			nr := r8 * 0.90
			ng := g8*0.95 + b8*0.05
			nb := b8*1.10 + g8*0.05
			if nb > 255 {
				nb = 255
			}

			// Slight desaturation.
			gray := 0.299*r8 + 0.587*g8 + 0.114*b8
			nr = nr*0.9 + gray*0.1
			ng = ng*0.9 + gray*0.1
			nb = nb*0.9 + gray*0.1

			// Subtle contrast boost.
			nr = (nr-128)*1.08 + 128
			ng = (ng-128)*1.08 + 128
			nb = (nb-128)*1.08 + 128

			dst.SetRGBA(x, y, color.RGBA{
				R: clamp8(int(r8*inv + nr*strength)),
				G: clamp8(int(g8*inv + ng*strength)),
				B: clamp8(int(b8*inv + nb*strength)),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Warm
// ──────────────────────────────────────────────

// Warm applies a warm-toned look: shifted toward orange/yellow, slightly
// saturated, with a gentle contrast reduction for a soft golden-hour feel.
// strength in [0, 1].
func Warm(img image.Image, strength float64) image.Image {
	if strength <= 0 {
		return img
	}
	if strength > 1 {
		strength = 1
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	inv := 1 - strength
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			r8, g8, b8 := float64(r/256), float64(g/256), float64(b/256)

			// Shift toward warm: boost red/orange, reduce blue.
			nr := r8*1.10 + g8*0.05
			if nr > 255 {
				nr = 255
			}
			ng := g8*1.02 + r8*0.04
			if ng > 255 {
				ng = 255
			}
			nb := b8 * 0.88

			// Slight saturation boost.
			gray := 0.299*r8 + 0.587*g8 + 0.114*b8
			nr = nr*1.05 + gray*(-0.05)
			ng = ng*1.05 + gray*(-0.05)
			nb = nb*1.05 + gray*(-0.05)

			// Gentle contrast reduction.
			nr = (nr-128)*0.95 + 128
			ng = (ng-128)*0.95 + 128
			nb = (nb-128)*0.95 + 128

			dst.SetRGBA(x, y, color.RGBA{
				R: clamp8(int(r8*inv + nr*strength)),
				G: clamp8(int(g8*inv + ng*strength)),
				B: clamp8(int(b8*inv + nb*strength)),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}
