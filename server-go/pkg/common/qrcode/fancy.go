// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Fancy / styled QR code generation using github.com/yeqown/go-qrcode.
//
// This file provides high-level helpers for generating visually
// customized QR codes with:
//
//   - Custom module shapes (circle, rounded, liquid, stripes, diamond)
//   - Custom finder pattern (corner) shapes (rounded, square)
//   - Solid foreground / background colors
//   - Linear gradient foreground
//   - Transparent background
//   - Logo overlay with safe zone
//   - Halftone QR (modules rendered from a source image)
//   - Adjustable module (block) width and border width
//   - PNG output (lossless, supports transparency)

package qrcode

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"io"
	"os"

	yqrcode "github.com/yeqown/go-qrcode/v2"
	"github.com/yeqown/go-qrcode/writer/standard"
	"github.com/yeqown/go-qrcode/writer/standard/shapes"
)

// ──────────────────────────────────────────────
// Shape types
// ──────────────────────────────────────────────

// ModuleShape describes the visual shape of each QR module (data bit).
type ModuleShape int

const (
	// ShapeRectangle uses the default square modules.
	ShapeRectangle ModuleShape = iota
	// ShapeCircle renders each module as a filled circle.
	ShapeCircle
	// ShapeRounded renders each module as a rounded rectangle.
	ShapeRounded
	// ShapeLiquid renders connected modules as a single liquid blob.
	ShapeLiquid
	// ShapeHStripe renders each module as horizontal stripes.
	ShapeHStripe
	// ShapeVStripe renders each module as vertical stripes.
	ShapeVStripe
	// ShapeDiamond renders each module as a 45° rotated square.
	ShapeDiamond
)

// FinderShape describes the visual shape of the three corner finder
// patterns.
type FinderShape int

const (
	// FinderRounded renders rounded finder patterns.
	FinderRounded FinderShape = iota
	// FinderSquare renders square finder patterns (default).
	FinderSquare
)

// ──────────────────────────────────────────────
// Fancy options
// ──────────────────────────────────────────────

// FancyOptions controls the visual style of a fancy QR code.
// All fields are optional; zero values produce sensible defaults.
type FancyOptions struct {
	// Module shape for data blocks. Default: ShapeRectangle.
	Module ModuleShape
	// Finder (corner) shape. Default: FinderSquare.
	Finder FinderShape

	// Foreground color (modules). If FgGradient is set, this is ignored.
	// Default: black.
	FgColor color.Color
	// Background color. If BgTransparent is true, this is ignored.
	// Default: white.
	BgColor color.Color
	// BgTransparent makes the background transparent (PNG only).
	BgTransparent bool

	// FgGradient applies a linear gradient to the foreground modules.
	// If set, FgColor is ignored.
	FgGradient *LinearGradient

	// Logo image to place at the center. Optional.
	Logo image.Image
	// LogoSizeMultiplier controls logo size relative to QR width.
	// Default is 4 (logo = 1/4 of QR). Use 5 for a smaller logo.
	LogoSizeMultiplier int
	// LogoSafeZone adds a white safe zone around the logo.
	LogoSafeZone bool

	// Halftone image — modules are rendered from this image, creating
	// an artistic QR. Optional.
	Halftone image.Image

	// ModuleWidth is the pixel width of each QR module. Default: 21.
	ModuleWidth uint8
	// BorderWidth is the quiet-zone width in pixels on all 4 sides.
	// Default: 0 (no extra border).
	BorderWidth int
}

// LinearGradient is a linear color gradient for QR foreground modules.
type LinearGradient struct {
	Angle float64     // degrees, 0 = horizontal left→right
	Stops []ColorStop // color stops along the gradient
}

// ColorStop represents a single color at position T (0.0 to 1.0).
type ColorStop struct {
	Color color.Color
	T     float64
}

// NewLinearGradient creates a linear gradient with the given angle and
// color stops.
func NewLinearGradient(angle float64, stops ...ColorStop) *LinearGradient {
	return &LinearGradient{Angle: angle, Stops: stops}
}

// ──────────────────────────────────────────────
// Internal: build yeqown options from FancyOptions
// ──────────────────────────────────────────────

// toRGBA converts a color.Color to color.RGBA.
func toRGBA(c color.Color) color.RGBA {
	if c == nil {
		return color.RGBA{0, 0, 0, 255}
	}
	r, g, b, a := c.RGBA()
	return color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8)}
}

func (o *FancyOptions) toYeqownOptions() []standard.ImageOption {
	opts := []standard.ImageOption{
		standard.WithBuiltinImageEncoder(standard.PNG_FORMAT),
	}

	// Background.
	if o.BgTransparent {
		opts = append(opts, standard.WithBgTransparent())
	} else if o.BgColor != nil {
		opts = append(opts, standard.WithBgColor(o.BgColor))
	}

	// Foreground.
	if o.FgGradient != nil {
		stops := make([]standard.ColorStop, len(o.FgGradient.Stops))
		for i, s := range o.FgGradient.Stops {
			stops[i] = standard.ColorStop{Color: toRGBA(s.Color), T: s.T}
		}
		opts = append(opts, standard.WithFgGradient(standard.NewGradient(o.FgGradient.Angle, stops...)))
	} else if o.FgColor != nil {
		opts = append(opts, standard.WithFgColor(o.FgColor))
	}

	// Module shape + finder shape.
	shapeBuilt := false
	switch o.Module {
	case ShapeCircle:
		opts = append(opts, standard.WithCircleShape())
		shapeBuilt = true
	case ShapeRounded:
		opts = append(opts, standard.WithCustomShape(
			shapes.Assemble(finderFn(o.Finder), roundedBlock)))
		shapeBuilt = true
	case ShapeLiquid:
		opts = append(opts, standard.WithCustomShape(
			shapes.Assemble(finderFn(o.Finder), shapes.LiquidBlock())))
		shapeBuilt = true
	case ShapeHStripe:
		opts = append(opts, standard.WithCustomShape(
			shapes.Assemble(finderFn(o.Finder), shapes.HStripeBlock(0.3))))
		shapeBuilt = true
	case ShapeVStripe:
		opts = append(opts, standard.WithCustomShape(
			shapes.Assemble(finderFn(o.Finder), shapes.VStripeBlock(0.3))))
		shapeBuilt = true
	case ShapeDiamond:
		opts = append(opts, standard.WithCustomShape(
			shapes.Assemble(finderFn(o.Finder), diamondBlock)))
		shapeBuilt = true
	}

	// If module shape is rectangle but finder is rounded, set custom shape
	// that uses default rectangle blocks but rounded finder.
	if !shapeBuilt && o.Finder == FinderRounded {
		opts = append(opts, standard.WithCustomShape(
			shapes.Assemble(shapes.RoundedFinder(), rectangleBlock)))
	}

	// Logo.
	if o.Logo != nil {
		opts = append(opts, standard.WithLogoImage(o.Logo))
		if o.LogoSizeMultiplier > 0 {
			opts = append(opts, standard.WithLogoSizeMultiplier(o.LogoSizeMultiplier))
		}
		if o.LogoSafeZone {
			opts = append(opts, standard.WithLogoSafeZone())
		}
	}

	// Halftone.
	if o.Halftone != nil {
		opts = append(opts, standard.WithHalftoneImage(o.Halftone))
	}

	// Module width.
	if o.ModuleWidth > 0 {
		opts = append(opts, standard.WithQRWidth(o.ModuleWidth))
	}

	// Border width.
	if o.BorderWidth > 0 {
		opts = append(opts, standard.WithBorderWidth(o.BorderWidth))
	}

	return opts
}

// finderFn returns the appropriate finder drawing function.
func finderFn(f FinderShape) func(ctx *standard.DrawContext) {
	if f == FinderRounded {
		return shapes.RoundedFinder()
	}
	return shapes.SquareFinder()
}

// ──────────────────────────────────────────────
// Custom block shapes
// ──────────────────────────────────────────────

// rectangleBlock renders each module as a plain rectangle (same as the
// default, but usable with shapes.Assemble for custom finder patterns).
func rectangleBlock(ctx *standard.DrawContext) {
	x, y := ctx.UpperLeft()
	w, h := ctx.Edge()
	ctx.DrawRectangle(x, y, float64(w), float64(h))
	ctx.SetColor(ctx.Color())
	ctx.Fill()
}

// roundedBlock renders each module as a rounded rectangle.
func roundedBlock(ctx *standard.DrawContext) {
	x, y := ctx.UpperLeft()
	w, h := ctx.Edge()
	r := float64(w) * 0.25
	ctx.DrawRoundedRectangle(x, y, float64(w), float64(h), r)
	ctx.SetColor(ctx.Color())
	ctx.Fill()
}

// diamondBlock renders each module as a 45° rotated square.
func diamondBlock(ctx *standard.DrawContext) {
	x, y := ctx.UpperLeft()
	w, h := ctx.Edge()
	cx := x + float64(w)/2
	cy := y + float64(h)/2
	half := float64(w) / 2 * 0.85
	ctx.MoveTo(cx, cy-half)
	ctx.LineTo(cx+half, cy)
	ctx.LineTo(cx, cy+half)
	ctx.LineTo(cx-half, cy)
	ctx.ClosePath()
	ctx.SetColor(ctx.Color())
	ctx.Fill()
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

// GenerateFancy creates a styled QR code and returns it as a PNG-encoded
// byte slice.
func GenerateFancy(text string, level ErrorCorrectionLevel, opts FancyOptions) ([]byte, error) {
	if text == "" {
		return nil, fmt.Errorf("qrcode: text is empty")
	}

	ecLevel := yqrcode.ErrorCorrectionQuart
	switch level {
	case ECLLow:
		ecLevel = yqrcode.ErrorCorrectionLow
	case ECLMedium:
		ecLevel = yqrcode.ErrorCorrectionMedium
	case ECLQuartile:
		ecLevel = yqrcode.ErrorCorrectionQuart
	case ECLHigh:
		ecLevel = yqrcode.ErrorCorrectionHighest
	}

	qr, err := yqrcode.NewWith(text, yqrcode.WithErrorCorrectionLevel(ecLevel))
	if err != nil {
		return nil, fmt.Errorf("qrcode: fancy encode: %w", err)
	}

	var buf bytes.Buffer
	w := standard.NewWithWriter(nopWriteCloser{&buf}, opts.toYeqownOptions()...)
	if err := qr.Save(w); err != nil {
		return nil, fmt.Errorf("qrcode: fancy render: %w", err)
	}
	return buf.Bytes(), nil
}

// SaveFancy creates a styled QR code and writes it to a PNG file.
func SaveFancy(text, path string, level ErrorCorrectionLevel, opts FancyOptions) error {
	data, err := GenerateFancy(text, level, opts)
	if err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("qrcode: create %s: %w", path, err)
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}

// GenerateFancyImage creates a styled QR code and returns it as an
// image.Image (decoded from the internally-generated PNG).
func GenerateFancyImage(text string, level ErrorCorrectionLevel, opts FancyOptions) (image.Image, error) {
	data, err := GenerateFancy(text, level, opts)
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("qrcode: decode fancy png: %w", err)
	}
	return img, nil
}

// ──────────────────────────────────────────────
// Preset helpers
// ──────────────────────────────────────────────

// FancyCirclePreset returns options for a clean circle-module QR with
// the given foreground and background colors.
func FancyCirclePreset(fg, bg color.Color) FancyOptions {
	return FancyOptions{
		Module:      ShapeCircle,
		FgColor:     fg,
		BgColor:     bg,
		ModuleWidth: 21,
		BorderWidth: 20,
	}
}

// FancyGradientPreset returns options for a circle-module QR with a
// linear gradient foreground.
func FancyGradientPreset(gradient *LinearGradient) FancyOptions {
	return FancyOptions{
		Module:      ShapeCircle,
		FgGradient:  gradient,
		BgColor:     color.White,
		ModuleWidth: 21,
		BorderWidth: 20,
	}
}

// FancyLogoPreset returns options for a QR with a logo at the center,
// rounded finder patterns, and circle modules.
func FancyLogoPreset(logo image.Image) FancyOptions {
	return FancyOptions{
		Module:             ShapeCircle,
		Finder:             FinderRounded,
		FgColor:            color.Black,
		BgColor:            color.White,
		Logo:               logo,
		LogoSizeMultiplier: 5,
		LogoSafeZone:       true,
		ModuleWidth:        21,
		BorderWidth:        20,
	}
}

// FancyHalftonePreset returns options for a halftone QR where modules
// are rendered from the given source image.
func FancyHalftonePreset(src image.Image, fg color.Color) FancyOptions {
	return FancyOptions{
		Module:      ShapeRectangle,
		FgColor:     fg,
		BgColor:     color.White,
		Halftone:    src,
		ModuleWidth: 21,
		BorderWidth: 20,
	}
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// nopWriteCloser wraps a writer to satisfy io.WriteCloser without
// closing the underlying writer.
type nopWriteCloser struct {
	io.Writer
}

func (nopWriteCloser) Close() error { return nil }
