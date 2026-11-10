// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Text watermark rendering using golang.org/x/image/font/opentype. Ships with
// the built-in Go font family (goregular/gobold/gomedium/goitalic/gomono) so
// no external .ttf is required, but also supports loading custom TrueType /
// OpenType font files via LoadFont / RegisterFont. Supports placement
// (center / bottom-right / tiled) and rotation (for diagonal "CONFIDENTIAL"
// overlays).

package imageutil

import (
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"math"
	"os"
	"sync"

	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goitalic"
	"golang.org/x/image/font/gofont/gomedium"
	"golang.org/x/image/font/gofont/gomono"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/f64"
	"golang.org/x/image/math/fixed"
)

// ──────────────────────────────────────────────
// Built-in font names
// ──────────────────────────────────────────────

// Built-in font names that can be used in TextWatermarkOptions.Font without
// loading any external file.
const (
	FontGoRegular = "goregular" // default
	FontGoBold    = "gobold"
	FontGoMedium  = "gomedium"
	FontGoItalic  = "goitalic"
	FontGoMono    = "gomono"
)

// ──────────────────────────────────────────────
// Text watermark options
// ──────────────────────────────────────────────

// TextWatermarkOptions controls text watermark rendering.
type TextWatermarkOptions struct {
	// Font selects a registered font by name. Empty / "goregular" uses the
	// default built-in Go regular font. Use one of the FontGo* constants for
	// the other built-in styles, or a name you registered via RegisterFont /
	// LoadFont.
	Font string
	// FontSize is the font size in points. Default 24.
	FontSize float64
	// Color is the text color. Default color.White.
	Color color.Color
	// Opacity in [0, 1]. Default 0.5.
	Opacity float64
	// Angle is the rotation in degrees (clockwise). 0 = horizontal.
	// Used by TextWatermarkTiled and ignored by the positional variants.
	Angle float64
	// Padding is the margin from the edge (in pixels) for positional variants,
	// or the spacing between tiles for Tiled. Default 10 / 50.
	Padding int
}

// withDefaults applies default values to zero fields.
func (o *TextWatermarkOptions) withDefaults() TextWatermarkOptions {
	out := *o
	if out.Font == "" {
		out.Font = FontGoRegular
	}
	if out.FontSize <= 0 {
		out.FontSize = 24
	}
	if out.Color == nil {
		out.Color = color.White
	}
	if out.Opacity <= 0 {
		out.Opacity = 0.5
	}
	if out.Opacity > 1 {
		out.Opacity = 1
	}
	return out
}

// ──────────────────────────────────────────────
// Font registry
// ──────────────────────────────────────────────

var (
	fontMu    sync.RWMutex
	fonts     = map[string]*opentype.Font{}
	fontsOnce sync.Once
)

// registerBuiltins registers all built-in Go fonts once.
func registerBuiltins() {
	fontsOnce.Do(func() {
		builtins := map[string][]byte{
			FontGoRegular: goregular.TTF,
			FontGoBold:    gobold.TTF,
			FontGoMedium:  gomedium.TTF,
			FontGoItalic:  goitalic.TTF,
			FontGoMono:    gomono.TTF,
		}
		for name, ttf := range builtins {
			f, err := opentype.Parse(ttf)
			if err != nil {
				// Embedded fonts are valid; this should never fail.
				panic("imageutil: failed to parse built-in font " + name + ": " + err.Error())
			}
			fonts[name] = f
		}
	})
}

// RegisterFont registers a parsed OpenType font under the given name. The
// name can then be used in TextWatermarkOptions.Font. Registering an existing
// name overwrites it.
func RegisterFont(name string, f *opentype.Font) {
	if name == "" {
		panic("imageutil: RegisterFont with empty name")
	}
	if f == nil {
		panic("imageutil: RegisterFont with nil font")
	}
	registerBuiltins()
	fontMu.Lock()
	defer fontMu.Unlock()
	fonts[name] = f
}

// LoadFont reads a TrueType / OpenType file (.ttf / .otf) from path, parses
// it, and registers it under name. The name can then be used in
// TextWatermarkOptions.Font. Returns an error if the file cannot be read or
// parsed.
func LoadFont(name, path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("imageutil: load font %s: %w", path, err)
	}
	f, err := opentype.Parse(data)
	if err != nil {
		return fmt.Errorf("imageutil: parse font %s: %w", path, err)
	}
	RegisterFont(name, f)
	return nil
}

// LoadFontBytes registers a font from raw TTF/OTF bytes under name. Useful
// when the font is embedded via go:embed or obtained from another source.
func LoadFontBytes(name string, data []byte) error {
	f, err := opentype.Parse(data)
	if err != nil {
		return fmt.Errorf("imageutil: parse font bytes: %w", err)
	}
	RegisterFont(name, f)
	return nil
}

// LoadFontTTC reads a TrueType Collection (.ttc) file, extracts the font at
// the given index, and registers it under name. This is needed for CJK fonts
// on macOS (PingFang.ttc, Hiragino Sans GB.ttc, etc.) which ship as .ttc
// collections rather than standalone .ttf files. Returns an error if the
// file cannot be read, the index is out of range, or the extracted font
// cannot be parsed.
func LoadFontTTC(name, path string, index int) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("imageutil: read ttc %s: %w", path, err)
	}
	extracted, err := extractTTCFont(data, index)
	if err != nil {
		return fmt.Errorf("imageutil: extract ttc %s[%d]: %w", path, index, err)
	}
	return LoadFontBytes(name, extracted)
}

// extractTTCFont extracts a single font from a TrueType Collection (.ttc)
// by reconstructing a standalone TTF from the shared table data. If the data
// is not a TTC (no 'ttcf' header), it is returned as-is.
func extractTTCFont(data []byte, index int) ([]byte, error) {
	if len(data) < 12 || string(data[0:4]) != "ttcf" {
		return data, nil // not a TTC
	}
	numFonts := int(binary.BigEndian.Uint32(data[8:12]))
	if index >= numFonts {
		return nil, fmt.Errorf("font index %d out of range (%d fonts)", index, numFonts)
	}
	fontOffset := binary.BigEndian.Uint32(data[12+index*4 : 16+index*4])
	if int(fontOffset)+12 > len(data) {
		return nil, fmt.Errorf("font offset %d beyond file size", fontOffset)
	}

	numTables := int(binary.BigEndian.Uint16(data[fontOffset+4 : fontOffset+6]))

	type rec struct{ offset, length uint32 }
	records := make([]rec, numTables)
	for i := 0; i < numTables; i++ {
		r := fontOffset + 12 + uint32(i*16)
		records[i].offset = binary.BigEndian.Uint32(data[r+8 : r+12])
		records[i].length = binary.BigEndian.Uint32(data[r+12 : r+16])
	}

	headerSize := 12 + numTables*16
	totalSize := headerSize
	for _, r := range records {
		totalSize += (int(r.length) + 3) &^ 3
	}

	out := make([]byte, totalSize)
	copy(out[0:12], data[fontOffset:fontOffset+12])
	dataOff := uint32(headerSize)
	for i, r := range records {
		recOff := 12 + i*16
		// Copy tag + checksum from original record
		src := fontOffset + 12 + uint32(i*16)
		copy(out[recOff:recOff+8], data[src:src+8])
		binary.BigEndian.PutUint32(out[recOff+8:recOff+12], dataOff)
		binary.BigEndian.PutUint32(out[recOff+12:recOff+16], r.length)
		copy(out[dataOff:dataOff+r.length], data[r.offset:r.offset+r.length])
		dataOff += uint32((int(r.length) + 3) &^ 3)
	}
	return out, nil
}

// lookupFont returns the registered font for name, falling back to the
// default goregular if name is unknown. Returns nil only if even the
// default failed to register (impossible for the built-in fonts).
func lookupFont(name string) *opentype.Font {
	registerBuiltins()
	fontMu.RLock()
	defer fontMu.RUnlock()
	if f, ok := fonts[name]; ok {
		return f
	}
	return fonts[FontGoRegular]
}

// newFace creates a font.Face for the given font name and size (in points at
// 96 DPI). Caller must call Close on the returned face.
func newFace(fontName string, size float64) font.Face {
	f := lookupFont(fontName)
	face, err := opentype.NewFace(f, &opentype.FaceOptions{
		Size:    size,
		DPI:     96,
		Hinting: font.HintingFull,
	})
	if err != nil {
		// Fallback: try without hinting.
		face, err = opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 96})
		if err != nil {
			panic("imageutil: failed to create font face: " + err.Error())
		}
	}
	return face
}

// measureText returns the width and ascent+descent height of the given text.
func measureText(face font.Face, text string) (w, h int) {
	d := &font.Drawer{Face: face}
	advance := d.MeasureString(text)
	metrics := face.Metrics()
	w = int((advance + 63) / 64) // fixed.Int26_6 -> pixels (round up)
	h = int((metrics.Height + 63) / 64)
	return
}

// renderText draws `text` onto a new RGBA canvas just big enough to fit it.
// The text baseline is placed so the full glyph height is visible.
func renderText(text string, fontName string, size float64, c color.Color) image.Image {
	face := newFace(fontName, size)
	defer face.Close()

	w, h := measureText(face, text)
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	d := &font.Drawer{
		Dst:  dst,
		Src:  &image.Uniform{C: c},
		Face: face,
		Dot:  fixed.Point26_6{X: 0, Y: (face.Metrics().Ascent + 63) / 64 * 64},
	}
	d.DrawString(text)
	return dst
}

// ──────────────────────────────────────────────
// Text watermark — positional
// ──────────────────────────────────────────────

// TextWatermark draws a text watermark at (x, y) from the top-left of the
// text bounding box.
func TextWatermark(base image.Image, text string, x, y int, opts TextWatermarkOptions) image.Image {
	o := opts.withDefaults()
	txt := renderText(text, o.Font, o.FontSize, o.Color)
	return Watermark(base, txt, x, y, o.Opacity)
}

// TextWatermarkCenter draws a text watermark centered on the base image.
func TextWatermarkCenter(base image.Image, text string, opts TextWatermarkOptions) image.Image {
	o := opts.withDefaults()
	txt := renderText(text, o.Font, o.FontSize, o.Color)
	bw, bh := Dimensions(base)
	tw, th := Dimensions(txt)
	return Watermark(base, txt, (bw-tw)/2, (bh-th)/2, o.Opacity)
}

// TextWatermarkBottomRight draws a text watermark at the bottom-right corner
// with the given padding.
func TextWatermarkBottomRight(base image.Image, text string, opts TextWatermarkOptions) image.Image {
	o := opts.withDefaults()
	if o.Padding <= 0 {
		o.Padding = 10
	}
	txt := renderText(text, o.Font, o.FontSize, o.Color)
	bw, bh := Dimensions(base)
	tw, th := Dimensions(txt)
	return Watermark(base, txt, bw-tw-o.Padding, bh-th-o.Padding, o.Opacity)
}

// ──────────────────────────────────────────────
// Text watermark — tiled (rotated)
// ──────────────────────────────────────────────

// TextWatermarkTiled repeats the text across the entire image, rotated by
// opts.Angle (degrees, clockwise). Typical use: a -30° "CONFIDENTIAL" or
// "DEMO" overlay. opts.Padding controls spacing between tiles (default 50).
func TextWatermarkTiled(base image.Image, text string, opts TextWatermarkOptions) image.Image {
	o := opts.withDefaults()
	if o.Padding <= 0 {
		o.Padding = 50
	}

	// 1. Render the text once.
	txt := renderText(text, o.Font, o.FontSize, o.Color)

	// 2. Rotate the text tile.
	angle := o.Angle * math.Pi / 180
	rotated := rotateImage(txt, angle)
	rw, rh := Dimensions(rotated)

	// 3. Tile the rotated tile across a canvas slightly larger than the base
	//    so edges are covered, then crop to the base size.
	bw, bh := Dimensions(base)
	stepX := rw + o.Padding
	stepY := rh + o.Padding

	// Canvas large enough to cover the base after rotation offset.
	cw := bw + stepX
	ch := bh + stepY
	canvas := image.NewRGBA(image.Rect(0, 0, cw, ch))
	// Draw the base image first so the text is overlaid on it, not on void.
	draw.Draw(canvas, image.Rect(0, 0, bw, bh), base, image.Point{}, draw.Src)
	// Start from -step so tiles fill from off-canvas.
	for y := -stepY; y < ch+stepY; y += stepY {
		for x := -stepX; x < cw+stepX; x += stepX {
			// Apply per-tile opacity by drawing through Watermark onto canvas.
			canvas = Watermark(canvas, rotated, x, y, o.Opacity).(*image.RGBA)
		}
	}

	// 4. Crop the canvas to the base size, starting from (0,0).
	dst := image.NewRGBA(image.Rect(0, 0, bw, bh))
	draw.Draw(dst, dst.Bounds(), canvas, image.Point{}, draw.Src)
	return dst
}

// ──────────────────────────────────────────────
// Rotation helper (affine transform via x/image/draw)
// ──────────────────────────────────────────────

// rotateImage returns a new image containing the source rotated by `angle`
// (radians, clockwise). The canvas is sized to fit the rotated bounding box,
// with the source centered. Empty areas are transparent.
func rotateImage(src image.Image, angle float64) image.Image {
	if angle == 0 {
		return src
	}
	sw, sh := Dimensions(src)
	cx, cy := float64(sw)/2, float64(sh)/2

	// Bounding box of rotated rectangle.
	cos := math.Abs(math.Cos(angle))
	sin := math.Abs(math.Sin(angle))
	newW := int(math.Ceil(float64(sw)*cos + float64(sh)*sin))
	newH := int(math.Ceil(float64(sw)*sin + float64(sh)*cos))

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))

	// Inverse affine (dst -> src): src = R^-1 * (dst - newCenter) + center
	// xdraw.Transform takes the inverse mapping (dst -> src).
	affine := f64.Aff3{
		math.Cos(angle), math.Sin(angle), cx - (math.Cos(angle)*float64(newW)/2 + math.Sin(angle)*float64(newH)/2),
		-math.Sin(angle), math.Cos(angle), cy - (-math.Sin(angle)*float64(newW)/2 + math.Cos(angle)*float64(newH)/2),
	}
	xdraw.BiLinear.Transform(dst, affine, src, src.Bounds(), draw.Over, nil)
	return dst
}
