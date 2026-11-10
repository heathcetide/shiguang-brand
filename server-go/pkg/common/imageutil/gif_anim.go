// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Animated GIF support: per-frame processing that preserves animation.
// Standard library image/gif only exposes EncodeAll for writing animated
// GIFs and DecodeAll for reading them; this file provides convenient
// helpers that apply resize / filter operations to every frame while
// keeping the animation timeline intact.
//
// Inspired by imgbed-main/server/utils/image.go compressGifAnimation,
// generalized into a reusable per-frame map API plus dedicated
// ResizeAnimatedGIF and OptimizeAnimatedGIF helpers.

package imageutil

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"io"
	"os"
)

// ──────────────────────────────────────────────
// Decode / encode animated GIF
// ──────────────────────────────────────────────

// DecodeAnimatedGIF reads an animated GIF from r and returns the full
// multi-frame structure. Non-animated GIFs are returned as a single-frame
// GIF (len(g.Image) == 1).
func DecodeAnimatedGIF(r io.Reader) (*gif.GIF, error) {
	g, err := gif.DecodeAll(r)
	if err != nil {
		return nil, fmt.Errorf("imageutil: decode animated gif: %w", err)
	}
	return g, nil
}

// EncodeAnimatedGIF writes an animated GIF to w.
func EncodeAnimatedGIF(w io.Writer, g *gif.GIF) error {
	if err := gif.EncodeAll(w, g); err != nil {
		return fmt.Errorf("imageutil: encode animated gif: %w", err)
	}
	return nil
}

// ──────────────────────────────────────────────
// Per-frame processing
// ──────────────────────────────────────────────

// MapAnimatedGIFFrames applies fn to every frame of g and returns a new
// *gif.GIF with the transformed frames. The disposal method, delays and
// other animation metadata are preserved. fn receives the frame as an
// image.Image and must return a new *image.Paletted (or any image.Image
// that can be paletted — non-paletted returns are quantized to 256 colors
// via a uniform palette).
//
// This is the building block for ResizeAnimatedGIF, OptimizeAnimatedGIF
// and any custom per-frame effect.
func MapAnimatedGIFFrames(g *gif.GIF, fn func(frame image.Image) image.Image) *gif.GIF {
	out := &gif.GIF{
		Delay:           append([]int(nil), g.Delay...),
		LoopCount:       g.LoopCount,
		Disposal:        append([]byte(nil), g.Disposal...),
		BackgroundIndex: g.BackgroundIndex,
		Config:          g.Config,
	}
	out.Image = make([]*image.Paletted, len(g.Image))
	for i, frame := range g.Image {
		transformed := fn(frame)
		out.Image[i] = toPaletted(transformed)
	}
	// Update the global config dimensions to match the first frame, if any.
	if len(out.Image) > 0 {
		b := out.Image[0].Bounds()
		out.Config.Width = b.Dx()
		out.Config.Height = b.Dy()
	}
	return out
}

// ResizeAnimatedGIF resizes every frame of an animated GIF to width×height
// (preserving aspect ratio when one dimension is 0) and returns a new
// *gif.GIF. Uses bilinear interpolation for a good speed/quality balance.
func ResizeAnimatedGIF(g *gif.GIF, width, height int) *gif.GIF {
	return MapAnimatedGIFFrames(g, func(frame image.Image) image.Image {
		return ResizeBilinear(frame, width, height)
	})
}

// OptimizeAnimatedGIF resizes each frame to fit within maxDim×maxDim
// (no upscaling) and returns the encoded bytes. Convenience wrapper for
// the common "shrink this GIF for the web" use case.
func OptimizeAnimatedGIF(g *gif.GIF, maxDim int) ([]byte, error) {
	resized := MapAnimatedGIFFrames(g, func(frame image.Image) image.Image {
		return Thumbnail(frame, maxDim, maxDim)
	})
	var buf bytes.Buffer
	if err := EncodeAnimatedGIF(&buf, resized); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ──────────────────────────────────────────────
// File-level helpers
// ──────────────────────────────────────────────

// ResizeAnimatedGIFFile reads an animated GIF from inputPath, resizes every
// frame, and writes the result to outputPath.
func ResizeAnimatedGIFFile(inputPath, outputPath string, width, height int) error {
	g, err := openAnimatedGIF(inputPath)
	if err != nil {
		return err
	}
	out := ResizeAnimatedGIF(g, width, height)
	return writeAnimatedGIF(out, outputPath)
}

// OptimizeAnimatedGIFFile reads an animated GIF, shrinks each frame to fit
// within maxDim×maxDim, and writes the result to outputPath.
func OptimizeAnimatedGIFFile(inputPath, outputPath string, maxDim int) error {
	g, err := openAnimatedGIF(inputPath)
	if err != nil {
		return err
	}
	data, err := OptimizeAnimatedGIF(g, maxDim)
	if err != nil {
		return err
	}
	return os.WriteFile(outputPath, data, 0o644)
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

// toPaletted converts any image.Image to *image.Paletted. If the source is
// already *image.Paletted it is returned as-is. Otherwise the image is
// drawn onto a new Paletted using a uniform 256-color palette with
// Floyd-Steinberg dithering. This keeps the GIF encoder happy without
// pulling in a full color quantizer.
func toPaletted(img image.Image) *image.Paletted {
	if p, ok := img.(*image.Paletted); ok {
		return p
	}
	b := img.Bounds()
	pal := uniformPalette()
	dst := image.NewPaletted(b, pal)
	draw.FloydSteinberg.Draw(dst, b, img, b.Min)
	return dst
}

// uniformPalette returns a 256-color palette suitable for GIF encoding of
// arbitrary RGB images: 6x7x6 RGB cube + 10 grayscale ramps + black/white.
func uniformPalette() color.Palette {
	const rLevels, gLevels, bLevels = 6, 7, 6
	pal := make(color.Palette, 0, 256)
	for r := 0; r < rLevels; r++ {
		for g := 0; g < gLevels; g++ {
			for b := 0; b < bLevels; b++ {
				pal = append(pal, color.RGBA{
					R: uint8(r * 255 / (rLevels - 1)),
					G: uint8(g * 255 / (gLevels - 1)),
					B: uint8(b * 255 / (bLevels - 1)),
					A: 255,
				})
			}
		}
	}
	// Grayscale ramp to fill remaining slots.
	used := rLevels * gLevels * bLevels
	remaining := 256 - used
	for i := 0; i < remaining; i++ {
		v := uint8(i * 255 / (remaining - 1))
		pal = append(pal, color.Gray{Y: v})
	}
	return pal
}

// openAnimatedGIF opens and decodes an animated GIF file.
func openAnimatedGIF(path string) (*gif.GIF, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("imageutil: open %s: %w", path, err)
	}
	defer f.Close()
	return DecodeAnimatedGIF(f)
}

// writeAnimatedGIF encodes and writes an animated GIF to a file path.
func writeAnimatedGIF(g *gif.GIF, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("imageutil: create %s: %w", path, err)
	}
	defer f.Close()
	return EncodeAnimatedGIF(f, g)
}
