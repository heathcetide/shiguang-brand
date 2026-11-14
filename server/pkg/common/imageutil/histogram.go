// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Image histogram and statistics. Uses only the Go standard library.

package imageutil

import (
	"image"
	"math"
)

// ──────────────────────────────────────────────
// Histogram
// ──────────────────────────────────────────────

// Histogram holds per-channel 256-bin intensity distributions and basic
// statistics. Counts are pixel counts; Prob[i] = Count[i] / TotalPixels.
type Histogram struct {
	Width  int
	Height int
	Total  int // total pixel count

	R, G, B, A [256]uint32 // per-channel counts
	Lum        [256]uint32 // luminance histogram (per-pixel weighted sum)

	// Statistics (over luminance).
	Mean   float64
	StdDev float64
	Min    uint8
	Max    uint8
}

// CalcHistogram computes the histogram and luminance statistics of an image.
// Luminance uses the standard ITU-R BT.601 weights (0.299, 0.587, 0.114).
func CalcHistogram(img image.Image) *Histogram {
	w, h := Dimensions(img)
	hist := &Histogram{Width: w, Height: h, Total: w * h, Min: 255}

	var sumLum, sumSq float64
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			r8 := uint8(r / 256)
			g8 := uint8(g / 256)
			b8 := uint8(b / 256)
			a8 := uint8(a / 256)
			hist.R[r8]++
			hist.G[g8]++
			hist.B[b8]++
			hist.A[a8]++

			lum := 0.299*float64(r8) + 0.587*float64(g8) + 0.114*float64(b8)
			sumLum += lum
			sumSq += lum * lum
			l8 := uint8(lum)
			hist.Lum[l8]++
			if l8 < hist.Min {
				hist.Min = l8
			}
			if l8 > hist.Max {
				hist.Max = l8
			}
		}
	}
	if hist.Total > 0 {
		hist.Mean = sumLum / float64(hist.Total)
		variance := sumSq/float64(hist.Total) - hist.Mean*hist.Mean
		if variance < 0 {
			variance = 0
		}
		hist.StdDev = math.Sqrt(variance)
	}
	return hist
}

// Luminance returns the luminance histogram (256 bins) computed per-pixel
// during construction. The sum of all bins equals Total.
func (h *Histogram) Luminance() [256]uint32 {
	return h.Lum
}

// MeanRGB returns the average R, G, B values (0-255 each).
func (h *Histogram) MeanRGB() (float64, float64, float64) {
	if h.Total == 0 {
		return 0, 0, 0
	}
	var rSum, gSum, bSum float64
	for i := 0; i < 256; i++ {
		rSum += float64(i) * float64(h.R[i])
		gSum += float64(i) * float64(h.G[i])
		bSum += float64(i) * float64(h.B[i])
	}
	tot := float64(h.Total)
	return rSum / tot, gSum / tot, bSum / tot
}

// Contrast returns a simple contrast metric: the standard deviation of
// luminance (same as StdDev).
func (h *Histogram) Contrast() float64 {
	return h.StdDev
}
