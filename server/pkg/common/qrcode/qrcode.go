// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package qrcode provides QR code generation (with optional logo overlay)
// and decoding. Generation uses github.com/boombuler/barcode; decoding uses
// github.com/makiuchi-d/gozxing (a Go port of ZXing). Logo overlay uses
// the local imageutil package for compositing.
package qrcode

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/qr"

	"github.com/heathcetide/DietDigiDose/pkg/common/imageutil"
)

// ErrorCorrectionLevel controls the redundancy of the QR code. Higher
// levels allow more damage (or a larger logo overlay) while remaining
// readable.
type ErrorCorrectionLevel int

const (
	// ECLLow recovers ~7% of data. Smallest QR, least tolerance.
	ECLLow ErrorCorrectionLevel = iota
	// ECLMedium recovers ~15%. Good general-purpose default.
	ECLMedium
	// ECLQuartile recovers ~25%. Recommended when embedding a logo.
	ECLQuartile
	// ECLHigh recovers ~30%. Maximum tolerance; largest QR.
	ECLHigh
)

// toBoombulerLevel converts our level to boombuler/barcode's qr.ErrorCorrectionLevel.
func toBoombulerLevel(l ErrorCorrectionLevel) qr.ErrorCorrectionLevel {
	switch l {
	case ECLLow:
		return qr.L
	case ECLMedium:
		return qr.M
	case ECLQuartile:
		return qr.Q
	case ECLHigh:
		return qr.H
	default:
		return qr.M
	}
}

// ──────────────────────────────────────────────
// Generation
// ──────────────────────────────────────────────

// Generate creates a QR code image from the given text. The returned
// image is scaled to size×size pixels (nearest-neighbor). If size is 0,
// the unscaled 1-module-per-pixel barcode is returned.
func Generate(text string, level ErrorCorrectionLevel, size int) (image.Image, error) {
	if text == "" {
		return nil, fmt.Errorf("qrcode: text is empty")
	}
	code, err := qr.Encode(text, toBoombulerLevel(level), qr.Auto)
	if err != nil {
		return nil, fmt.Errorf("qrcode: encode: %w", err)
	}
	if size > 0 {
		code, err = barcode.Scale(code, size, size)
		if err != nil {
			return nil, fmt.Errorf("qrcode: scale: %w", err)
		}
	}
	return code, nil
}

// GeneratePNG creates a QR code and encodes it as PNG bytes.
func GeneratePNG(text string, level ErrorCorrectionLevel, size int) ([]byte, error) {
	img, err := Generate(text, level, size)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("qrcode: png encode: %w", err)
	}
	return buf.Bytes(), nil
}

// Save generates a QR code and writes it to a PNG file.
func Save(text, path string, level ErrorCorrectionLevel, size int) error {
	img, err := Generate(text, level, size)
	if err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("qrcode: create %s: %w", path, err)
	}
	defer f.Close()
	return png.Encode(f, img)
}

// ──────────────────────────────────────────────
// Generation with logo
// ──────────────────────────────────────────────

// GenerateWithLogo creates a QR code with a logo image composited at the
// center. The logo is scaled to logoSize×logoSize pixels (if logoSize > 0,
// otherwise it defaults to ~20% of the QR size). A white background plate
// is drawn behind the logo for readability. The QR code should use at
// least ECLQuartile or ECLHigh when embedding a logo to maintain
// scannability.
func GenerateWithLogo(text string, level ErrorCorrectionLevel, size int, logo image.Image, logoSize int) (image.Image, error) {
	if text == "" {
		return nil, fmt.Errorf("qrcode: text is empty")
	}
	if logo == nil {
		return Generate(text, level, size)
	}

	// Generate the base QR code.
	qrImg, err := Generate(text, level, size)
	if err != nil {
		return nil, err
	}

	// Default logo size to 20% of QR size.
	if logoSize <= 0 {
		logoSize = size / 5
	}
	if logoSize > size/3 {
		logoSize = size / 3 // cap at 33% to maintain readability
	}

	// Scale the logo to the desired size.
	scaledLogo := imageutil.ResizeBilinear(logo, logoSize, logoSize)

	// Create a white background plate slightly larger than the logo
	// (10% padding on each side).
	plateSize := logoSize + logoSize/10
	if plateSize > size/3 {
		plateSize = size / 3
	}
	plate := image.NewRGBA(image.Rect(0, 0, plateSize, plateSize))
	for y := 0; y < plateSize; y++ {
		for x := 0; x < plateSize; x++ {
			plate.SetRGBA(x, y, color.RGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}

	// Composite: draw the white plate centered, then draw the logo centered.
	qrW, qrH := imageutil.Dimensions(qrImg)
	plateX := (qrW - plateSize) / 2
	plateY := (qrH - plateSize) / 2

	// Convert QR to RGBA for compositing.
	dst := image.NewRGBA(image.Rect(0, 0, qrW, qrH))
	// Draw QR code.
	for y := 0; y < qrH; y++ {
		for x := 0; x < qrW; x++ {
			dst.Set(x, y, qrImg.At(x, y))
		}
	}

	// Draw white plate.
	for y := 0; y < plateSize; y++ {
		for x := 0; x < plateSize; x++ {
			px, py := plateX+x, plateY+y
			if px >= 0 && px < qrW && py >= 0 && py < qrH {
				dst.SetRGBA(px, py, color.RGBA{R: 255, G: 255, B: 255, A: 255})
			}
		}
	}

	// Draw logo on top of plate.
	logoX := (qrW - logoSize) / 2
	logoY := (qrH - logoSize) / 2
	for y := 0; y < logoSize; y++ {
		for x := 0; x < logoSize; x++ {
			px, py := logoX+x, logoY+y
			if px >= 0 && px < qrW && py >= 0 && py < qrH {
				dst.Set(px, py, scaledLogo.At(x, y))
			}
		}
	}

	return dst, nil
}

// GenerateWithLogoPNG creates a QR code with a logo and encodes it as PNG.
func GenerateWithLogoPNG(text string, level ErrorCorrectionLevel, size int, logo image.Image, logoSize int) ([]byte, error) {
	img, err := GenerateWithLogo(text, level, size, logo, logoSize)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("qrcode: png encode: %w", err)
	}
	return buf.Bytes(), nil
}

// SaveWithLogo generates a QR code with a logo and writes it to a PNG file.
func SaveWithLogo(text, path string, level ErrorCorrectionLevel, size int, logo image.Image, logoSize int) error {
	img, err := GenerateWithLogo(text, level, size, logo, logoSize)
	if err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("qrcode: create %s: %w", path, err)
	}
	defer f.Close()
	return png.Encode(f, img)
}

// ──────────────────────────────────────────────
// Generation with logo from file
// ──────────────────────────────────────────────

// GenerateWithLogoFile is like GenerateWithLogo but loads the logo from
// a file path.
func GenerateWithLogoFile(text string, level ErrorCorrectionLevel, size int, logoPath string, logoSize int) (image.Image, error) {
	logo, _, err := imageutil.DecodeFile(logoPath)
	if err != nil {
		return nil, fmt.Errorf("qrcode: load logo %s: %w", logoPath, err)
	}
	return GenerateWithLogo(text, level, size, logo, logoSize)
}

// SaveWithLogoFile generates a QR code with a logo loaded from a file and
// writes the result to a PNG file.
func SaveWithLogoFile(text, outputPath string, level ErrorCorrectionLevel, size int, logoPath string, logoSize int) error {
	img, err := GenerateWithLogoFile(text, level, size, logoPath, logoSize)
	if err != nil {
		return err
	}
	f, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("qrcode: create %s: %w", outputPath, err)
	}
	defer f.Close()
	return png.Encode(f, img)
}
