// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Composite operations: blend modes, borders, padding (letterbox), and tiled
// watermarks. Uses only the Go standard library.

package imageutil

import (
	"image"
	"image/color"
	"image/draw"
)

// ──────────────────────────────────────────────
// Blend modes
// ──────────────────────────────────────────────

// BlendMode is a per-channel compositing operation used by Blend.
type BlendMode int

const (
	// BlendNormal places the top layer over the base, honoring top's alpha.
	BlendNormal BlendMode = iota
	// BlendMultiply: result = base * top / 255. Darkens.
	BlendMultiply
	// BlendScreen: result = 255 - (255-base)*(255-top)/255. Lightens.
	BlendScreen
	// BlendOverlay: multiply where base < 128, screen otherwise. Increases contrast.
	BlendOverlay
	// BlendAdd (Linear Dodge): result = base + top. Clips to 255.
	BlendAdd
	// BlendSubtract: result = base - top. Clips to 0.
	BlendSubtract
	// BlendDifference: result = |base - top|.
	BlendDifference
	// BlendDarken: result = min(base, top).
	BlendDarken
	// BlendLighten: result = max(base, top).
	BlendLighten
)

// Blend composites the top image onto the base image using the given mode.
// The two images need not be the same size: top is anchored at (0,0) and
// regions outside top are left unchanged. Top's alpha is honored as opacity.
func Blend(base, top image.Image, mode BlendMode) image.Image {
	w, h := Dimensions(base)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), base, image.Point{}, draw.Src)

	tw, th := Dimensions(top)
	for y := 0; y < th && y < h; y++ {
		for x := 0; x < tw && x < w; x++ {
			bc := dst.RGBAAt(x, y)
			tc := top.At(x, y)
			tr, tg, tb, ta := tc.RGBA()
			if ta == 0 {
				continue
			}
			opacity := float64(ta) / 65535
			r := blendChannel(mode, int(bc.R), int(tr/256), opacity)
			g := blendChannel(mode, int(bc.G), int(tg/256), opacity)
			b := blendChannel(mode, int(bc.B), int(tb/256), opacity)
			dst.SetRGBA(x, y, color.RGBA{R: r, G: g, B: b, A: bc.A})
		}
	}
	return dst
}

// blendChannel applies a blend mode to a single channel, mixing the result
// with the base by opacity (alpha blending the blended value back over base).
func blendChannel(mode BlendMode, base, top int, opacity float64) uint8 {
	var blended int
	switch mode {
	case BlendNormal:
		blended = top
	case BlendMultiply:
		blended = base * top / 255
	case BlendScreen:
		blended = 255 - (255-base)*(255-top)/255
	case BlendOverlay:
		if base < 128 {
			blended = 2 * base * top / 255
		} else {
			blended = 255 - 2*(255-base)*(255-top)/255
		}
	case BlendAdd:
		blended = base + top
	case BlendSubtract:
		blended = base - top
	case BlendDifference:
		if base > top {
			blended = base - top
		} else {
			blended = top - base
		}
	case BlendDarken:
		if base < top {
			blended = base
		} else {
			blended = top
		}
	case BlendLighten:
		if base > top {
			blended = base
		} else {
			blended = top
		}
	default:
		blended = top
	}
	mixed := float64(base)*(1-opacity) + float64(blended)*opacity
	return clamp8(int(mixed))
}

// ──────────────────────────────────────────────
// Border
// ──────────────────────────────────────────────

// AddBorder adds a solid-color border of the given thickness around the image.
// The result has dimensions (w+2*thickness) x (h+2*thickness).
func AddBorder(img image.Image, thickness int, c color.Color) image.Image {
	if thickness <= 0 {
		return img
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w+2*thickness, h+2*thickness))
	// Fill border color across the whole canvas, then draw the image on top.
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: c}, image.Point{}, draw.Src)
	draw.Draw(dst, image.Rect(thickness, thickness, thickness+w, thickness+h), img, image.Point{}, draw.Src)
	return dst
}

// ──────────────────────────────────────────────
// Padding (letterbox)
// ──────────────────────────────────────────────

// AddPadding pads the image to the target dimensions with a solid background
// color (letterbox/pillarbox). The source is placed centered. If the source
// is already larger than the target in either dimension, that axis is left
// unchanged (no upscaling of the canvas beyond the source for that axis).
func AddPadding(img image.Image, targetW, targetH int, bg color.Color) image.Image {
	w, h := Dimensions(img)
	if targetW < w {
		targetW = w
	}
	if targetH < h {
		targetH = h
	}
	if targetW == w && targetH == h {
		return img
	}
	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: bg}, image.Point{}, draw.Src)
	offX := (targetW - w) / 2
	offY := (targetH - h) / 2
	draw.Draw(dst, image.Rect(offX, offY, offX+w, offY+h), img, image.Point{}, draw.Src)
	return dst
}

// ──────────────────────────────────────────────
// Tiled watermark
// ──────────────────────────────────────────────

// TileWatermark repeats the watermark across the entire base image with the
// given spacing between tiles. Useful for diagonal "demo" / "confidential"
// overlays. opacity in [0, 1].
func TileWatermark(base, watermark image.Image, spacingX, spacingY int, opacity float64) image.Image {
	if opacity < 0 {
		opacity = 0
	}
	if opacity > 1 {
		opacity = 1
	}
	if spacingX <= 0 {
		spacingX = 1
	}
	if spacingY <= 0 {
		spacingY = 1
	}
	w, h := Dimensions(base)
	wmW, wmH := Dimensions(watermark)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), base, image.Point{}, draw.Src)

	stepX := wmW + spacingX
	stepY := wmH + spacingY
	// Offset by -stepX/-stepY so tiles start off-canvas and fill edges.
	for y := -stepY; y < h+stepY; y += stepY {
		for x := -stepX; x < w+stepX; x += stepX {
			for wy := 0; wy < wmH; wy++ {
				by := y + wy
				if by < 0 || by >= h {
					continue
				}
				for wx := 0; wx < wmW; wx++ {
					bx := x + wx
					if bx < 0 || bx >= w {
						continue
					}
					bc := dst.RGBAAt(bx, by)
					wc := watermark.At(wx, wy)
					wr, wg, wb, wa := wc.RGBA()
					if wa == 0 {
						continue
					}
					alpha := float64(wa) / 65535 * opacity
					blend := func(b, t uint32) uint8 {
						return uint8((float64(b)*(1-alpha) + float64(t)*alpha) / 256)
					}
					dst.SetRGBA(bx, by, color.RGBA{
						R: blend(uint32(bc.R)<<8, wr),
						G: blend(uint32(bc.G)<<8, wg),
						B: blend(uint32(bc.B)<<8, wb),
						A: bc.A,
					})
				}
			}
		}
	}
	return dst
}
