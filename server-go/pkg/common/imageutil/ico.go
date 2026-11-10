// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// ICO (Windows icon) writer: converts any decodable image into a multi-size
// .ico file containing PNG-encoded entries. No external dependencies — only
// the Go standard library (image/png, encoding/binary, golang.org/x/image/draw
// for high-quality downscaling).
//
// Inspired by imgbed-main/server/tools/png2ico, generalized to accept any
// image.Image and to expose both SaveICO and ToICO for in-memory use.

package imageutil

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"io"
	"os"

	xdraw "golang.org/x/image/draw"
)

// DefaultICOSizes is the set of sizes embedded by SaveICO/ToICO when no
// sizes are explicitly provided. Matches the sizes used by Windows favicon
// conventions: 256, 128, 64, 48, 32, 16.
var DefaultICOSizes = []int{256, 128, 64, 48, 32, 16}

// ──────────────────────────────────────────────
// Encode
// ──────────────────────────────────────────────

// ToICO encodes img into a multi-size Windows ICO file and returns the bytes.
// Each size in sizes is produced by downscaling img with a high-quality
// bilinear filter and then PNG-encoding the result (Vista+ supports PNG
// inside ICO). If sizes is nil/empty, DefaultICOSizes is used.
//
// The source image should ideally be square; non-square sources are
// center-cropped to a square before downscaling so the resulting icon is
// not distorted.
func ToICO(img image.Image, sizes []int) ([]byte, error) {
	if len(sizes) == 0 {
		sizes = DefaultICOSizes
	}
	square := cropToSquare(img)
	var entries [][]byte
	for _, size := range sizes {
		if size <= 0 {
			return nil, fmt.Errorf("imageutil: invalid ico size %d", size)
		}
		resized := downscaleSquare(square, size)
		data, err := encodePNGBytes(resized)
		if err != nil {
			return nil, fmt.Errorf("imageutil: encode ico entry %d: %w", size, err)
		}
		entries = append(entries, data)
	}
	var buf bytes.Buffer
	if err := writeICO(&buf, sizes, entries); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// SaveICO encodes img into a multi-size Windows ICO file and writes it to path.
// See ToICO for details on sizes and behavior.
func SaveICO(img image.Image, path string, sizes []int) error {
	data, err := ToICO(img, sizes)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

// cropToSquare center-crops img to a square whose side equals min(w, h).
func cropToSquare(img image.Image) image.Image {
	w, h := Dimensions(img)
	side := w
	if h < side {
		side = h
	}
	if w == h {
		return img
	}
	x := (w - side) / 2
	y := (h - side) / 2
	return Crop(img, image.Rect(x, y, x+side, y+side))
}

// downscaleSquare downscales a square source image to the given size using
// bilinear interpolation (good quality / speed trade-off for icons).
func downscaleSquare(src image.Image, size int) image.Image {
	w, _ := Dimensions(src)
	if w == size {
		return src
	}
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	xdraw.BiLinear.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Src, nil)
	return dst
}

// encodePNGBytes PNG-encodes img into a byte slice.
func encodePNGBytes(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// writeICO writes an ICO container with the given sizes and PNG entry bytes.
// Format reference: https://en.wikipedia.org/wiki/ICO_(file_format)
func writeICO(w io.Writer, sizes []int, entries [][]byte) error {
	count := uint16(len(entries))
	// ICONDIR (6 bytes)
	if err := binary.Write(w, binary.LittleEndian, uint16(0)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(1)); err != nil { // type=1 (icon)
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, count); err != nil {
		return err
	}
	// ICONDIRENTRY (16 bytes each)
	dataOffset := uint32(6 + int(count)*16)
	for i, size := range sizes {
		data := entries[i]
		// Width/Height: 0 represents 256.
		wh := uint8(size)
		if size >= 256 {
			wh = 0
		}
		// Reserved(1), ColorCount(1)=0, Planes(2)=1, BitCount(2)=32
		header := []byte{wh, wh, 0, 0, 1, 0, 32, 0}
		if _, err := w.Write(header); err != nil {
			return err
		}
		if err := binary.Write(w, binary.LittleEndian, uint32(len(data))); err != nil {
			return err
		}
		if err := binary.Write(w, binary.LittleEndian, dataOffset); err != nil {
			return err
		}
		dataOffset += uint32(len(data))
	}
	// Image data
	for _, data := range entries {
		if _, err := w.Write(data); err != nil {
			return err
		}
	}
	return nil
}
