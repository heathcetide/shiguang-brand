// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// QR code decoding (reading) using github.com/makiuchi-d/gozxing (a Go
// port of ZXing). Supports decoding from image.Image, file paths, and
// raw bytes.

package qrcode

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg" // register JPEG decoder
	_ "image/png"  // register PNG decoder
	"os"

	"github.com/makiuchi-d/gozxing"
	"github.com/makiuchi-d/gozxing/qrcode"
)

// Decode reads a QR code from an image and returns the decoded text.
// If no QR code is found, an error is returned.
func Decode(img image.Image) (string, error) {
	if img == nil {
		return "", fmt.Errorf("qrcode: image is nil")
	}

	// Convert to a format gozxing can read (it expects an image.Image
	// with integer pixel values; standard image.Image works).
	bmp, err := gozxing.NewBinaryBitmapFromImage(img)
	if err != nil {
		return "", fmt.Errorf("qrcode: new bitmap: %w", err)
	}

	reader := qrcode.NewQRCodeReader()
	result, err := reader.Decode(bmp, nil)
	if err != nil {
		return "", fmt.Errorf("qrcode: decode: %w", err)
	}

	return result.GetText(), nil
}

// DecodeFile reads an image file and decodes the QR code from it.
func DecodeFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("qrcode: open %s: %w", path, err)
	}
	defer f.Close()

	img, _, err := image.Decode(f)
	if err != nil {
		return "", fmt.Errorf("qrcode: decode image %s: %w", path, err)
	}

	return Decode(img)
}

// DecodeBytes decodes a QR code from raw image bytes (PNG, JPEG, etc.).
func DecodeBytes(data []byte) (string, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("qrcode: decode bytes: %w", err)
	}
	return Decode(img)
}
