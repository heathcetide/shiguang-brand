// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package barcode provides one-dimensional and two-dimensional barcode
// generation using github.com/boombuler/barcode. Supported types include
// Code128, Code39, Code93, Codabar, EAN-13, EAN-8, UPC-A, 2-of-5,
// PDF417, DataMatrix, and Aztec Code.
//
// # Quick start
//
//	// Generate a Code128 barcode as PNG bytes (300x100 px).
//	data, err := barcode.GeneratePNG(barcode.TypeCode128, "Hello123", 300, 100)
//	if err != nil { ... }
//	os.WriteFile("barcode.png", data, 0644)
//
//	// Generate with integer scale factor (no distortion).
//	img, err := barcode.GenerateWithScaleFactor(barcode.TypeQR, "data", 4, 40)
//
//	// List all supported barcode types.
//	types := barcode.SupportedTypes()
package barcode

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"os"
	"strings"

	"github.com/boombuler/barcode"
	"github.com/boombuler/barcode/aztec"
	"github.com/boombuler/barcode/codabar"
	"github.com/boombuler/barcode/code128"
	"github.com/boombuler/barcode/code39"
	"github.com/boombuler/barcode/code93"
	"github.com/boombuler/barcode/datamatrix"
	"github.com/boombuler/barcode/ean"
	"github.com/boombuler/barcode/pdf417"
	"github.com/boombuler/barcode/twooffive"
)

// BarcodeType identifies the barcode symbology.
type BarcodeType string

const (
	TypeCode128    BarcodeType = "code128"
	TypeCode39     BarcodeType = "code39"
	TypeCode93     BarcodeType = "code93"
	TypeCodabar    BarcodeType = "codabar"
	TypeEAN13      BarcodeType = "ean13"
	TypeEAN8       BarcodeType = "ean8"
	TypeUPCA       BarcodeType = "upca"
	TypeTwoOfFive  BarcodeType = "2of5"
	TypePDF417     BarcodeType = "pdf417"
	TypeDataMatrix BarcodeType = "datamatrix"
	TypeAztec      BarcodeType = "aztec"
)

// ──────────────────────────────────────────────
// Options for advanced barcode generation
// ──────────────────────────────────────────────

// Options holds configurable parameters for barcode generation.
// Not all fields apply to all barcode types; irrelevant fields are ignored.
type Options struct {
	// PDF417SecurityLevel is the error correction security level (0-8).
	// Higher levels add more redundancy. Default is 8 (max).
	// Only used for TypePDF417.
	PDF417SecurityLevel byte

	// AztecECCPercent is the minimum error correction percentage (1-100).
	// Default is aztec.DEFAULT_EC_PERCENT (33).
	// Only used for TypeAztec.
	AztecECCPercent int

	// AztecLayers specifies the number of data layers.
	// 0 = auto-select. Positive = normal mode, negative = compact mode.
	// Only used for TypeAztec.
	AztecLayers int

	// Code39FullASCII enables full ASCII mode for Code39.
	// Only used for TypeCode39.
	Code39FullASCII bool

	// Code93FullASCII enables full ASCII mode for Code93.
	// Only used for TypeCode93.
	Code93FullASCII bool

	// TwoOfFiveInterleaved enables interleaved 2-of-5 mode.
	// Only used for TypeTwoOfFive.
	TwoOfFiveInterleaved bool
}

// DefaultOptions returns Options with sensible defaults.
func DefaultOptions() Options {
	return Options{
		PDF417SecurityLevel: 8,
		AztecECCPercent:     aztec.DEFAULT_EC_PERCENT,
		AztecLayers:         0,
	}
}

// ──────────────────────────────────────────────
// Generic generate
// ──────────────────────────────────────────────

// Generate creates a barcode of the specified type from the given content.
// The returned image is the raw barcode at 1 module per pixel; use Scale
// or GenerateScaled for a pixel-sized output. Returns an error for
// invalid content (e.g. wrong length for EAN).
//
// For configurable parameters (PDF417 security level, Aztec ECC, etc.),
// use GenerateWithOptions.
func Generate(typ BarcodeType, content string) (image.Image, error) {
	return GenerateWithOptions(typ, content, DefaultOptions())
}

// GenerateWithOptions creates a barcode with configurable parameters.
func GenerateWithOptions(typ BarcodeType, content string, opts Options) (image.Image, error) {
	// Validate content: reject empty or whitespace-only strings.
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("barcode: content is empty or whitespace-only")
	}

	var (
		img barcode.Barcode
		err error
	)

	switch typ {
	case TypeCode128:
		img, err = code128.Encode(content)
	case TypeCode39:
		img, err = code39.Encode(content, false, opts.Code39FullASCII)
	case TypeCode93:
		img, err = code93.Encode(content, false, opts.Code93FullASCII)
	case TypeCodabar:
		img, err = codabar.Encode(content)
	case TypeEAN13:
		img, err = ean.Encode(content)
	case TypeEAN8:
		// ean.Encode dispatches by length: 7/8 digits → EAN-8,
		// 12/13 digits → EAN-13. No separate EAN-8 entry needed.
		img, err = ean.Encode(content)
	case TypeUPCA:
		// UPC-A is a 12-digit barcode that is a subset of EAN-13
		// with a leading 0. We always prepend "0" so that:
		//   - 11 digits → "0"+11 = 12 digits → EAN-13 auto-checksum
		//   - 12 digits → "0"+12 = 13 digits → EAN-13 validates checksum
		// This ensures correct checksum handling in both cases.
		img, err = ean.Encode("0" + content)
	case TypeTwoOfFive:
		img, err = twooffive.Encode(content, opts.TwoOfFiveInterleaved)
	case TypePDF417:
		img, err = pdf417.Encode(content, opts.PDF417SecurityLevel)
	case TypeDataMatrix:
		img, err = datamatrix.Encode(content)
	case TypeAztec:
		img, err = aztec.Encode([]byte(content), opts.AztecECCPercent, opts.AztecLayers)
	default:
		return nil, fmt.Errorf("barcode: unknown type %q", typ)
	}

	if err != nil {
		return nil, fmt.Errorf("barcode: encode %s: %w", typ, err)
	}
	return img, nil
}

// GenerateScaled creates a barcode and scales it to the given pixel
// dimensions. For 1D barcodes, width should be much larger than height.
//
// Note: the underlying barcode.Scale uses integer scaling factors and
// centers the barcode within the target dimensions. For 1D barcodes,
// the width is integer-scaled (no module distortion) and the height
// is stretched. For 2D barcodes, the smaller integer factor is used
// and the barcode is centered with padding.
//
// For explicit integer-factor scaling without padding, use
// GenerateWithScaleFactor.
func GenerateScaled(typ BarcodeType, content string, width, height int) (image.Image, error) {
	return GenerateScaledWithOptions(typ, content, DefaultOptions(), width, height)
}

// GenerateScaledWithOptions is like GenerateScaled but accepts Options.
func GenerateScaledWithOptions(typ BarcodeType, content string, opts Options, width, height int) (image.Image, error) {
	img, err := GenerateWithOptions(typ, content, opts)
	if err != nil {
		return nil, err
	}
	return scaleImage(img, width, height)
}

// GenerateWithScaleFactor creates a barcode and scales it by an integer
// factor. This is the recommended scaling method because it guarantees
// no module distortion — each module is rendered as exactly factor×factor
// pixels. The resulting image dimensions are:
//
//	1D barcode: width = originalWidth * factor, height = height
//	2D barcode: width = originalWidth * factor, height = originalHeight * factor
//
// For 2D barcodes, the height parameter is ignored (use factor for both
// dimensions). For 1D barcodes, height controls the bar height in pixels.
func GenerateWithScaleFactor(typ BarcodeType, content string, factor, height int) (image.Image, error) {
	return GenerateWithScaleFactorWithOptions(typ, content, DefaultOptions(), factor, height)
}

// GenerateWithScaleFactorWithOptions is like GenerateWithScaleFactor but
// accepts Options.
func GenerateWithScaleFactorWithOptions(typ BarcodeType, content string, opts Options, factor, height int) (image.Image, error) {
	img, err := GenerateWithOptions(typ, content, opts)
	if err != nil {
		return nil, err
	}

	if factor <= 0 {
		return img, nil // return unscaled
	}

	bc, ok := img.(barcode.Barcode)
	if !ok {
		return img, nil
	}

	orgBounds := bc.Bounds()
	orgWidth := orgBounds.Dx()
	orgHeight := orgBounds.Dy()

	dimensions := bc.Metadata().Dimensions
	var targetWidth, targetHeight int

	switch dimensions {
	case 1:
		targetWidth = orgWidth * factor
		if height > 0 {
			targetHeight = height
		} else {
			targetHeight = orgHeight * factor
		}
	case 2:
		targetWidth = orgWidth * factor
		targetHeight = orgHeight * factor
		_ = height // ignored for 2D
	default:
		return img, nil
	}

	return scaleImage(img, targetWidth, targetHeight)
}

// GeneratePNG creates a barcode and encodes it as PNG bytes.
func GeneratePNG(typ BarcodeType, content string, width, height int) ([]byte, error) {
	return GeneratePNGWithOptions(typ, content, DefaultOptions(), width, height)
}

// GeneratePNGWithOptions is like GeneratePNG but accepts Options.
func GeneratePNGWithOptions(typ BarcodeType, content string, opts Options, width, height int) ([]byte, error) {
	img, err := GenerateScaledWithOptions(typ, content, opts, width, height)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("barcode: png encode: %w", err)
	}
	return buf.Bytes(), nil
}

// Save generates a barcode and writes it to a PNG file.
func Save(typ BarcodeType, content, path string, width, height int) error {
	return SaveWithOptions(typ, content, path, DefaultOptions(), width, height)
}

// SaveWithOptions is like Save but accepts Options.
func SaveWithOptions(typ BarcodeType, content, path string, opts Options, width, height int) error {
	img, err := GenerateScaledWithOptions(typ, content, opts, width, height)
	if err != nil {
		return err
	}
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("barcode: create %s: %w", path, err)
	}
	defer f.Close()
	return png.Encode(f, img)
}

// ──────────────────────────────────────────────
// Convenience functions for common types
// ──────────────────────────────────────────────

// Code128 generates a Code128 barcode (supports full ASCII).
func Code128(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeCode128, content, width, height)
}

// Code39 generates a Code39 barcode (uppercase A-Z, 0-9, and - . $ / + % SPACE).
func Code39(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeCode39, content, width, height)
}

// Code93 generates a Code93 barcode (full ASCII via shift characters).
func Code93(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeCode93, content, width, height)
}

// Codabar generates a Codabar barcode (digits and -$:/.+ABCD).
func Codabar(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeCodabar, content, width, height)
}

// EAN13 generates an EAN-13 barcode (12 or 13 digits; checksum is
// auto-calculated if 12 digits are provided).
func EAN13(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeEAN13, content, width, height)
}

// EAN8 generates an EAN-8 barcode (7 or 8 digits; checksum is
// auto-calculated if 7 digits are provided).
func EAN8(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeEAN8, content, width, height)
}

// UPCA generates a UPC-A barcode (11 or 12 digits; checksum is
// auto-calculated if 11 digits are provided). UPC-A is a subset of
// EAN-13 with a leading 0.
func UPCA(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeUPCA, content, width, height)
}

// UPC_A is a deprecated alias for UPCA. Use UPCA instead.
// Deprecated: use UPCA for Go naming compliance.
func UPC_A(content string, width, height int) (image.Image, error) {
	return UPCA(content, width, height)
}

// TwoOfFive generates an Industrial 2-of-5 barcode (digits only).
func TwoOfFive(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeTwoOfFive, content, width, height)
}

// PDF417 generates a PDF417 stacked barcode with default security level 8.
// For custom security level, use GenerateWithOptions.
func PDF417(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypePDF417, content, width, height)
}

// DataMatrix generates a DataMatrix 2D barcode.
func DataMatrix(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeDataMatrix, content, width, height)
}

// Aztec generates an Aztec 2D barcode with default ECC percentage.
// For custom ECC or layers, use GenerateWithOptions.
func Aztec(content string, width, height int) (image.Image, error) {
	return GenerateScaled(TypeAztec, content, width, height)
}

// ──────────────────────────────────────────────
// Metadata
// ──────────────────────────────────────────────

// Metadata holds information about a generated barcode.
type Metadata struct {
	CodeKind   string // barcode type name (e.g. "Code 128")
	Dimensions byte   // 1 for 1D, 2 for 2D
	Content    string // encoded content
}

// GetMetadata extracts metadata from a generated barcode image. Only
// works on unscaled barcodes (before barcode.Scale is applied).
func GetMetadata(img image.Image) (*Metadata, error) {
	bc, ok := img.(barcode.Barcode)
	if !ok {
		return nil, fmt.Errorf("barcode: image is not a barcode (type %T)", img)
	}
	meta := bc.Metadata()
	return &Metadata{
		CodeKind:   meta.CodeKind,
		Dimensions: meta.Dimensions,
		Content:    bc.Content(),
	}, nil
}

// ──────────────────────────────────────────────
// Supported types
// ──────────────────────────────────────────────

// SupportedTypes returns all barcode types supported by this package.
// The order is deterministic and matches the const declaration order.
func SupportedTypes() []BarcodeType {
	return []BarcodeType{
		TypeCode128,
		TypeCode39,
		TypeCode93,
		TypeCodabar,
		TypeEAN13,
		TypeEAN8,
		TypeUPCA,
		TypeTwoOfFive,
		TypePDF417,
		TypeDataMatrix,
		TypeAztec,
	}
}

// TypeName returns a human-readable name for a barcode type.
func TypeName(typ BarcodeType) string {
	switch typ {
	case TypeCode128:
		return "Code 128"
	case TypeCode39:
		return "Code 39"
	case TypeCode93:
		return "Code 93"
	case TypeCodabar:
		return "Codabar"
	case TypeEAN13:
		return "EAN-13"
	case TypeEAN8:
		return "EAN-8"
	case TypeUPCA:
		return "UPC-A"
	case TypeTwoOfFive:
		return "2 of 5"
	case TypePDF417:
		return "PDF417"
	case TypeDataMatrix:
		return "DataMatrix"
	case TypeAztec:
		return "Aztec"
	default:
		return string(typ)
	}
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

// scaleImage scales a barcode image to the target dimensions. If the
// image does not implement barcode.Barcode, it is returned as-is.
func scaleImage(img image.Image, width, height int) (image.Image, error) {
	if width <= 0 || height <= 0 {
		return img, nil
	}
	bc, ok := img.(barcode.Barcode)
	if !ok {
		return img, nil
	}
	scaled, err := barcode.Scale(bc, width, height)
	if err != nil {
		return nil, fmt.Errorf("barcode: scale: %w", err)
	}
	return scaled, nil
}
