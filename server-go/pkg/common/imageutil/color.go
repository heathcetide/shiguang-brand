// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Extended color adjustments: hue rotation, color temperature, tint,
// posterize, and binarization (threshold). All operate per-pixel using only
// the Go standard library.

package imageutil

import (
	"image"
	"image/color"
	"math"
)

// ──────────────────────────────────────────────
// Hue rotation
// ──────────────────────────────────────────────

// HueRotate rotates the hue of every pixel by the given degrees (0-360).
// 0/360 leaves colors unchanged; 180 inverts hues.
func HueRotate(img image.Image, degrees float64) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	rot := math.Mod(degrees, 360) / 60.0 // sector shift
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			hue, sat, val := rgbToHSV(uint8(r/256), uint8(g/256), uint8(b/256))
			hue = math.Mod(hue+rot, 6)
			if hue < 0 {
				hue += 6
			}
			nr, ng, nb := hsvToRGB(hue, sat, val)
			dst.SetRGBA(x, y, color.RGBA{R: nr, G: ng, B: nb, A: uint8(a / 256)})
		}
	}
	return dst
}

// rgbToHSV converts an 8-bit RGB triple to HSV where:
//   - h is in [0, 6) (sector units; multiply by 60 for degrees)
//   - s, v are in [0, 1]
func rgbToHSV(r, g, b uint8) (h, s, v float64) {
	rf := float64(r) / 255
	gf := float64(g) / 255
	bf := float64(b) / 255
	max := math.Max(rf, math.Max(gf, bf))
	min := math.Min(rf, math.Min(gf, bf))
	v = max
	delta := max - min
	if max == 0 {
		s = 0
	} else {
		s = delta / max
	}
	if delta == 0 {
		h = 0
	} else {
		switch max {
		case rf:
			h = math.Mod((gf-bf)/delta, 6)
		case gf:
			h = (bf-rf)/delta + 2
		case bf:
			h = (rf-gf)/delta + 4
		}
		if h < 0 {
			h += 6
		}
	}
	return
}

// hsvToRGB converts HSV (h in [0,6), s/v in [0,1]) back to 8-bit RGB.
func hsvToRGB(h, s, v float64) (uint8, uint8, uint8) {
	c := v * s
	x := c * (1 - math.Abs(math.Mod(h, 2)-1))
	m := v - c
	var r, g, b float64
	switch {
	case h < 1:
		r, g, b = c, x, 0
	case h < 2:
		r, g, b = x, c, 0
	case h < 3:
		r, g, b = 0, c, x
	case h < 4:
		r, g, b = 0, x, c
	case h < 5:
		r, g, b = x, 0, c
	default:
		r, g, b = c, 0, x
	}
	return uint8(math.Round((r + m) * 255)),
		uint8(math.Round((g + m) * 255)),
		uint8(math.Round((b + m) * 255))
}

// ──────────────────────────────────────────────
// Color temperature
// ──────────────────────────────────────────────

// AdjustTemperature shifts the color temperature of the image.
// delta in [-100, 100]: positive warms (more red, less blue),
// negative cools (more blue, less red). 0 leaves the image unchanged.
func AdjustTemperature(img image.Image, delta int) image.Image {
	if delta == 0 {
		return img
	}
	if delta < -100 {
		delta = -100
	}
	if delta > 100 {
		delta = 100
	}
	// Scale to ±50 channel shift.
	shift := delta / 2
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			dst.SetRGBA(x, y, color.RGBA{
				R: clamp8(int(r/256) + shift),
				G: uint8(g / 256),
				B: clamp8(int(b/256) - shift),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Tint
// ──────────────────────────────────────────────

// Tint applies a color tint over the image. amount in [0, 1] controls the
// strength: 0 leaves the image unchanged, 1 fully replaces color with c.
func Tint(img image.Image, c color.Color, amount float64) image.Image {
	if amount <= 0 {
		return img
	}
	if amount > 1 {
		amount = 1
	}
	tr, tg, tb, _ := c.RGBA()
	tr8, tg8, tb8 := uint8(tr/256), uint8(tg/256), uint8(tb/256)
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	inv := 1 - amount
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			dst.SetRGBA(x, y, color.RGBA{
				R: clamp8(int(float64(r/256)*inv + float64(tr8)*amount)),
				G: clamp8(int(float64(g/256)*inv + float64(tg8)*amount)),
				B: clamp8(int(float64(b/256)*inv + float64(tb8)*amount)),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Posterize
// ──────────────────────────────────────────────

// Posterize reduces the number of distinct colors per channel.
// levels in [2, 255]: 2 yields a 2-tone posterization per channel,
// 255 leaves the image effectively unchanged.
func Posterize(img image.Image, levels int) image.Image {
	if levels < 2 {
		levels = 2
	}
	if levels > 255 {
		levels = 255
	}
	// Precompute LUT: quantize each 0-255 value to `levels` steps.
	lut := make([]uint8, 256)
	step := 255 / (levels - 1)
	for i := 0; i < 256; i++ {
		v := int(float64(i)/255*float64(levels-1) + 0.5)
		lut[i] = clamp8(v * step)
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			dst.SetRGBA(x, y, color.RGBA{
				R: lut[r/256],
				G: lut[g/256],
				B: lut[b/256],
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Threshold (binarize)
// ──────────────────────────────────────────────

// Threshold binarizes the image: pixels whose luminance is >= level become
// white, others become black. level in [0, 255].
func Threshold(img image.Image, level int) image.Image {
	if level < 0 {
		level = 0
	}
	if level > 255 {
		level = 255
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			lum := 0.299*float64(r/256) + 0.587*float64(g/256) + 0.114*float64(b/256)
			v := uint8(0)
			if int(lum) >= level {
				v = 255
			}
			dst.SetRGBA(x, y, color.RGBA{R: v, G: v, B: v, A: uint8(a / 256)})
		}
	}
	return dst
}
