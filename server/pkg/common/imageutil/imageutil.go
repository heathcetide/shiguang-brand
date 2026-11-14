// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package imageutil provides image processing utilities built on top of the
// Go standard library and the official golang.org/x/image subrepository plus
// the widely-used disintegration/imaging package:
//
//   - Decode/Encode: JPEG, PNG, GIF, BMP, TIFF, WebP (encode via
//     github.com/deepteams/webp — pure Go, no CGo)
//   - Resize: nearest-neighbor, bilinear, CatmullRom (Lanczos-quality),
//     Lanczos — via golang.org/x/image/draw kernels and imaging filters;
//     plus fit-with-padding (letterbox)
//   - Crop: rectangular, center, smart, aspect-ratio with 9-grid anchor,
//     circular, rounded corners
//   - Rotate: 90/180/270 degrees
//   - Flip: horizontal, vertical
//   - Grayscale: luminance-based conversion
//   - Adjust: brightness, contrast, gamma, saturation, hue, color
//     temperature, tint
//   - Filters: box blur, gaussian blur (imaging), sharpen (imaging unsharp
//     mask), edge detect (Sobel), emboss
//   - Cinematic looks: vintage, cool, warm (per-pixel, strength-controlled)
//   - Effects: invert, sepia, posterize, threshold (binarize), vignette,
//     noise/grain, pixelate (mosaic)
//   - Quality: JPEG re-encode with quality control
//   - Thumbnail: proportional downscale (with optional padding)
//   - Watermark: image overlay (center/bottom-right/tiled) and text watermark
//     (center/bottom-right/tiled-rotated, built-in Go font — no .ttf needed)
//   - Composite: blend modes (multiply/screen/overlay/add/...), border,
//     padding
//   - Info: dimensions, format detection, histogram & statistics
//   - Convert: format conversion (e.g. PNG → JPEG), PNG → ICO (favicon)
//   - Animated GIF: per-frame resize/optimize preserving animation
//   - Color: hex color parsing (#rgb / #rgba / #rrggbb / #rrggbbaa)
//
// # Quick start
//
//	img, _, _ := imageutil.DecodeFile("input.png")
//	resized := imageutil.ResizeBilinear(img, 200, 0)    // width=200, auto height
//	hq     := imageutil.ResizeLanczos(img, 200, 0)      // high-quality
//	cropped := imageutil.Crop(img, image.Rect(10, 10, 110, 110))
//	blurred := imageutil.GaussianBlur(img, 3, 0)
//	rounded := imageutil.RoundCorners(img, 24)
//	imageutil.SaveJPEG(resized, "output.jpg", 85)
//	imageutil.SaveWebP(resized, "output.webp", 80)      // WebP encode
//	imageutil.SaveICO(img, "favicon.ico", nil)          // multi-size ICO
package imageutil

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"os"
	"strings"

	// Register the WebP decoder with the image package so image.Decode
	// recognizes it. (TIFF is imported below as xtiff for encoding, which
	// also registers its decoder.)
	_ "golang.org/x/image/webp"

	xdraw "golang.org/x/image/draw"
	xtiff "golang.org/x/image/tiff"
)

// ──────────────────────────────────────────────
// Format type
// ──────────────────────────────────────────────

// Format represents an image file format.
type Format string

const (
	FormatJPEG Format = "jpeg"
	FormatPNG  Format = "png"
	FormatGIF  Format = "gif"
	FormatBMP  Format = "bmp"
	FormatTIFF Format = "tiff"
	FormatWebP Format = "webp"
)

// FormatFromExtension returns the format for a file extension.
func FormatFromExtension(ext string) (Format, error) {
	switch strings.ToLower(strings.TrimPrefix(ext, ".")) {
	case "jpg", "jpeg":
		return FormatJPEG, nil
	case "png":
		return FormatPNG, nil
	case "gif":
		return FormatGIF, nil
	case "bmp":
		return FormatBMP, nil
	case "tif", "tiff":
		return FormatTIFF, nil
	case "webp":
		return FormatWebP, nil
	default:
		return "", fmt.Errorf("imageutil: unknown extension %q", ext)
	}
}

// ──────────────────────────────────────────────
// Decode / Encode
// ──────────────────────────────────────────────

// Decode decodes an image from a reader and returns the image and its format.
func Decode(r io.Reader) (image.Image, Format, error) {
	img, formatStr, err := image.Decode(r)
	if err != nil {
		return nil, "", fmt.Errorf("imageutil: decode: %w", err)
	}
	return img, Format(formatStr), nil
}

// DecodeConfig decodes image config (dimensions, format) without full decode.
func DecodeConfig(r io.Reader) (image.Config, Format, error) {
	cfg, formatStr, err := image.DecodeConfig(r)
	if err != nil {
		return image.Config{}, "", fmt.Errorf("imageutil: decode config: %w", err)
	}
	return cfg, Format(formatStr), nil
}

// DecodeFile decodes an image from a file path.
func DecodeFile(path string) (image.Image, Format, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", fmt.Errorf("imageutil: open %s: %w", path, err)
	}
	defer f.Close()
	return Decode(f)
}

// Encode encodes an image to the specified format and writes to w.
// WebP encoding is supported via github.com/deepteams/webp (pure Go, no CGo).
// For WebP, quality is in [1, 100] (lossy); pass a negative quality to use
// lossless encoding.
func Encode(w io.Writer, img image.Image, format Format, quality int) error {
	switch format {
	case FormatJPEG:
		return jpeg.Encode(w, img, &jpeg.Options{Quality: quality})
	case FormatPNG:
		return png.Encode(w, img)
	case FormatGIF:
		return gif.Encode(w, img, &gif.Options{NumColors: 256})
	case FormatTIFF:
		return xtiff.Encode(w, img, &xtiff.Options{Compression: xtiff.Deflate})
	case FormatWebP:
		return encodeWebP(w, img, quality)
	default:
		return fmt.Errorf("imageutil: unsupported encode format %q", format)
	}
}

// SaveJPEG saves an image as JPEG with the given quality (1-100).
func SaveJPEG(img image.Image, path string, quality int) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("imageutil: create %s: %w", path, err)
	}
	defer f.Close()
	return jpeg.Encode(f, img, &jpeg.Options{Quality: quality})
}

// SavePNG saves an image as PNG.
func SavePNG(img image.Image, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("imageutil: create %s: %w", path, err)
	}
	defer f.Close()
	return png.Encode(f, img)
}

// SaveGIF saves an image as GIF.
func SaveGIF(img image.Image, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("imageutil: create %s: %w", path, err)
	}
	defer f.Close()
	return gif.Encode(f, img, &gif.Options{NumColors: 256})
}

// SaveTIFF saves an image as TIFF (Deflate-compressed).
func SaveTIFF(img image.Image, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("imageutil: create %s: %w", path, err)
	}
	defer f.Close()
	return xtiff.Encode(f, img, &xtiff.Options{Compression: xtiff.Deflate})
}

// SaveWebP saves an image as WebP with the given quality (1-100, lossy).
// Pass a negative quality to use lossless encoding.
func SaveWebP(img image.Image, path string, quality int) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("imageutil: create %s: %w", path, err)
	}
	defer f.Close()
	return encodeWebP(f, img, quality)
}

// Save saves an image in the specified format. WebP encoding is supported
// via github.com/deepteams/webp. For WebP, pass a negative quality for
// lossless encoding.
func Save(img image.Image, path string, format Format, quality int) error {
	switch format {
	case FormatJPEG:
		return SaveJPEG(img, path, quality)
	case FormatPNG:
		return SavePNG(img, path)
	case FormatGIF:
		return SaveGIF(img, path)
	case FormatTIFF:
		return SaveTIFF(img, path)
	case FormatWebP:
		return SaveWebP(img, path, quality)
	default:
		return fmt.Errorf("imageutil: unsupported format %q", format)
	}
}

// SaveByExtension saves an image, inferring the format from the file extension.
func SaveByExtension(img image.Image, path string, quality int) error {
	idx := strings.LastIndex(path, ".")
	if idx < 0 {
		return fmt.Errorf("imageutil: no extension in path %q", path)
	}
	format, err := FormatFromExtension(path[idx:])
	if err != nil {
		return err
	}
	return Save(img, path, format, quality)
}

// ToBytes encodes an image to a byte slice.
func ToBytes(img image.Image, format Format, quality int) ([]byte, error) {
	var buf bytes.Buffer
	if err := Encode(&buf, img, format, quality); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// FromBytes decodes an image from a byte slice.
func FromBytes(data []byte) (image.Image, Format, error) {
	return Decode(bytes.NewReader(data))
}

// ──────────────────────────────────────────────
// Image info
// ──────────────────────────────────────────────

// Info holds basic image information.
type Info struct {
	Width  int
	Height int
	Format Format
}

// GetInfo returns image info from a file.
func GetInfo(path string) (*Info, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("imageutil: open %s: %w", path, err)
	}
	defer f.Close()
	cfg, format, err := DecodeConfig(f)
	if err != nil {
		return nil, err
	}
	return &Info{Width: cfg.Width, Height: cfg.Height, Format: format}, nil
}

// Dimensions returns the width and height of an image.
func Dimensions(img image.Image) (int, int) {
	b := img.Bounds()
	return b.Dx(), b.Dy()
}

// ──────────────────────────────────────────────
// Resize
// ──────────────────────────────────────────────

// ResizeNearest resizes an image using nearest-neighbor interpolation via
// golang.org/x/image/draw. If width or height is 0, it is computed to
// preserve aspect ratio. If both are 0, the original image is returned.
func ResizeNearest(img image.Image, width, height int) image.Image {
	srcW, srcH := Dimensions(img)
	width, height = calcDimensions(srcW, srcH, width, height)
	if width == srcW && height == srcH {
		return img
	}
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	xdraw.NearestNeighbor.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
	return dst
}

// ResizeBilinear resizes an image using bilinear interpolation via
// golang.org/x/image/draw. If width or height is 0, it is computed to
// preserve aspect ratio. If both are 0, the original image is returned.
func ResizeBilinear(img image.Image, width, height int) image.Image {
	srcW, srcH := Dimensions(img)
	width, height = calcDimensions(srcW, srcH, width, height)
	if width == srcW && height == srcH {
		return img
	}
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	xdraw.BiLinear.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
	return dst
}

// ResizeCatmullRom resizes an image using the CatmullRom cubic kernel via
// golang.org/x/image/draw. This is a high-quality interpolation suitable
// for downscaling photos. If width or height is 0, it is computed to
// preserve aspect ratio. If both are 0, the original image is returned.
func ResizeCatmullRom(img image.Image, width, height int) image.Image {
	srcW, srcH := Dimensions(img)
	width, height = calcDimensions(srcW, srcH, width, height)
	if width == srcW && height == srcH {
		return img
	}
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
	return dst
}

// Thumbnail creates a thumbnail that fits within the given dimensions,
// preserving aspect ratio. The result is never larger than the original.
func Thumbnail(img image.Image, maxWidth, maxHeight int) image.Image {
	srcW, srcH := Dimensions(img)
	if srcW <= maxWidth && srcH <= maxHeight {
		return img
	}
	ratio := math.Min(float64(maxWidth)/float64(srcW), float64(maxHeight)/float64(srcH))
	newW := int(float64(srcW) * ratio)
	newH := int(float64(srcH) * ratio)
	if newW < 1 {
		newW = 1
	}
	if newH < 1 {
		newH = 1
	}
	return ResizeBilinear(img, newW, newH)
}

// calcDimensions computes the target dimensions, preserving aspect ratio
// when one dimension is 0.
func calcDimensions(srcW, srcH, width, height int) (int, int) {
	if width == 0 && height == 0 {
		return srcW, srcH
	}
	if width == 0 {
		width = srcW * height / srcH
	}
	if height == 0 {
		height = srcH * width / srcW
	}
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}
	return width, height
}

// ──────────────────────────────────────────────
// Crop
// ──────────────────────────────────────────────

// Crop extracts a rectangular region from an image.
// The rectangle is clamped to the image bounds.
func Crop(img image.Image, rect image.Rectangle) image.Image {
	bounds := img.Bounds()
	rect = rect.Intersect(bounds)
	dst := image.NewRGBA(image.Rect(0, 0, rect.Dx(), rect.Dy()))
	draw.Draw(dst, dst.Bounds(), img, rect.Min, draw.Src)
	return dst
}

// CropCenter crops a square region from the center of the image.
func CropCenter(img image.Image, size int) image.Image {
	w, h := Dimensions(img)
	x := (w - size) / 2
	y := (h - size) / 2
	if x < 0 {
		x = 0
	}
	if y < 0 {
		y = 0
	}
	return Crop(img, image.Rect(x, y, x+size, y+size))
}

// CropTopLeft crops a square region from the top-left corner.
func CropTopLeft(img image.Image, size int) image.Image {
	return Crop(img, image.Rect(0, 0, size, size))
}

// CropSmart crops and resizes to the target dimensions, filling the frame
// (like CSS object-fit: cover). The source is cropped to match the target
// aspect ratio, then resized.
func CropSmart(img image.Image, targetW, targetH int) image.Image {
	srcW, srcH := Dimensions(img)
	targetRatio := float64(targetW) / float64(targetH)
	srcRatio := float64(srcW) / float64(srcH)

	var cropW, cropH int
	if srcRatio > targetRatio {
		// Source is wider: crop width.
		cropH = srcH
		cropW = int(float64(srcH) * targetRatio)
	} else {
		// Source is taller: crop height.
		cropW = srcW
		cropH = int(float64(srcW) / targetRatio)
	}
	x := (srcW - cropW) / 2
	y := (srcH - cropH) / 2
	cropped := Crop(img, image.Rect(x, y, x+cropW, y+cropH))
	return ResizeBilinear(cropped, targetW, targetH)
}

// ──────────────────────────────────────────────
// Rotate
// ──────────────────────────────────────────────

// Rotate90 rotates the image 90 degrees clockwise.
func Rotate90(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, h, w))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(h-1-y, x, img.At(x, y))
		}
	}
	return dst
}

// Rotate180 rotates the image 180 degrees.
func Rotate180(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(w-1-x, h-1-y, img.At(x, y))
		}
	}
	return dst
}

// Rotate270 rotates the image 270 degrees clockwise (90 counter-clockwise).
func Rotate270(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, h, w))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(y, w-1-x, img.At(x, y))
		}
	}
	return dst
}

// Rotate rotates by the given degrees. Only 90, 180, 270 are supported.
func Rotate(img image.Image, degrees int) (image.Image, error) {
	degrees = ((degrees % 360) + 360) % 360
	switch degrees {
	case 0:
		return img, nil
	case 90:
		return Rotate90(img), nil
	case 180:
		return Rotate180(img), nil
	case 270:
		return Rotate270(img), nil
	default:
		return nil, fmt.Errorf("imageutil: rotate only supports 90/180/270 degrees, got %d", degrees)
	}
}

// ──────────────────────────────────────────────
// Flip
// ──────────────────────────────────────────────

// FlipHorizontal flips the image horizontally (left-right).
func FlipHorizontal(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(w-1-x, y, img.At(x, y))
		}
	}
	return dst
}

// FlipVertical flips the image vertically (top-bottom).
func FlipVertical(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.Set(x, h-1-y, img.At(x, y))
		}
	}
	return dst
}

// ──────────────────────────────────────────────
// Color adjustments
// ──────────────────────────────────────────────

// Grayscale converts an image to grayscale using luminance weights.
func Grayscale(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.GrayModel.Convert(img.At(x, y)).(color.Gray)
			dst.SetGray(x, y, c)
		}
	}
	return dst
}

// AdjustBrightness adjusts the brightness of an image.
// delta is in [-255, 255]. Positive values brighten.
func AdjustBrightness(img image.Image, delta int) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			dst.Set(x, y, color.RGBA{
				R: clamp8(int(r/256) + delta),
				G: clamp8(int(g/256) + delta),
				B: clamp8(int(b/256) + delta),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// AdjustContrast adjusts the contrast of an image.
// factor of 1.0 means no change. Values > 1 increase contrast.
func AdjustContrast(img image.Image, factor float64) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			dst.Set(x, y, color.RGBA{
				R: clamp8(int(float64(r/256-128)*factor + 128)),
				G: clamp8(int(float64(g/256-128)*factor + 128)),
				B: clamp8(int(float64(b/256-128)*factor + 128)),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// AdjustGamma applies gamma correction to an image.
// gamma of 1.0 means no change. Values < 1 brighten, > 1 darken.
func AdjustGamma(img image.Image, gamma float64) image.Image {
	if gamma <= 0 {
		gamma = 1
	}
	lut := make([]uint8, 256)
	for i := 0; i < 256; i++ {
		val := 255 * math.Pow(float64(i)/255, 1/gamma)
		lut[i] = uint8(val)
	}
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			dst.Set(x, y, color.RGBA{
				R: lut[r/256],
				G: lut[g/256],
				B: lut[b/256],
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// AdjustSaturation adjusts the saturation of an image.
// factor of 1.0 means no change. 0 produces grayscale.
func AdjustSaturation(img image.Image, factor float64) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			r8, g8, b8 := r/256, g/256, b/256
			gray := uint32(0.299*float64(r8) + 0.587*float64(g8) + 0.114*float64(b8))
			dst.Set(x, y, color.RGBA{
				R: clamp8(int(float64(r8)*factor + float64(gray)*(1-factor))),
				G: clamp8(int(float64(g8)*factor + float64(gray)*(1-factor))),
				B: clamp8(int(float64(b8)*factor + float64(gray)*(1-factor))),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// Invert inverts the colors of an image (negative effect).
func Invert(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			dst.Set(x, y, color.RGBA{
				R: 255 - uint8(r/256),
				G: 255 - uint8(g/256),
				B: 255 - uint8(b/256),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// Sepia applies a sepia tone effect.
func Sepia(img image.Image) image.Image {
	w, h := Dimensions(img)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			r8, g8, b8 := float64(r/256), float64(g/256), float64(b/256)
			dst.Set(x, y, color.RGBA{
				R: clamp8(int(0.393*r8 + 0.769*g8 + 0.189*b8)),
				G: clamp8(int(0.349*r8 + 0.686*g8 + 0.168*b8)),
				B: clamp8(int(0.272*r8 + 0.534*g8 + 0.131*b8)),
				A: uint8(a / 256),
			})
		}
	}
	return dst
}

// clamp8 clamps an integer to [0, 255].
func clamp8(v int) uint8 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return uint8(v)
}

// ──────────────────────────────────────────────
// Watermark / overlay
// ──────────────────────────────────────────────

// Watermark overlays a watermark image onto a base image at the given position.
// opacity is in [0, 1]. The watermark is drawn at (x, y) from the top-left.
func Watermark(base, watermark image.Image, x, y int, opacity float64) image.Image {
	if opacity < 0 {
		opacity = 0
	}
	if opacity > 1 {
		opacity = 1
	}
	w, h := Dimensions(base)
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(dst, dst.Bounds(), base, image.Point{}, draw.Src)

	wmW, wmH := Dimensions(watermark)
	wmRect := image.Rect(x, y, x+wmW, y+wmH)
	wmRect = wmRect.Intersect(dst.Bounds())
	if wmRect.Empty() {
		return dst
	}

	for wy := wmRect.Min.Y; wy < wmRect.Max.Y; wy++ {
		for wx := wmRect.Min.X; wx < wmRect.Max.X; wx++ {
			br, bg, bb, ba := dst.At(wx, wy).RGBA()
			wr, wg, wb, wa := watermark.At(wx-x, wy-y).RGBA()
			alpha := float64(wa) / 65535 * opacity
			blend := func(bc, wc uint32) uint8 {
				return uint8((float64(bc)*(1-alpha) + float64(wc)*alpha) / 256)
			}
			dst.Set(wx, wy, color.RGBA{
				R: blend(br, wr),
				G: blend(bg, wg),
				B: blend(bb, wb),
				A: uint8(ba / 256),
			})
		}
	}
	return dst
}

// WatermarkCenter overlays a watermark at the center of the base image.
func WatermarkCenter(base, watermark image.Image, opacity float64) image.Image {
	bw, bh := Dimensions(base)
	ww, wh := Dimensions(watermark)
	return Watermark(base, watermark, (bw-ww)/2, (bh-wh)/2, opacity)
}

// WatermarkBottomRight overlays a watermark at the bottom-right corner.
func WatermarkBottomRight(base, watermark image.Image, opacity float64, padding int) image.Image {
	bw, bh := Dimensions(base)
	ww, wh := Dimensions(watermark)
	return Watermark(base, watermark, bw-ww-padding, bh-wh-padding, opacity)
}

// ──────────────────────────────────────────────
// Format conversion
// ──────────────────────────────────────────────

// ConvertFormat reads an image file and saves it in a different format.
func ConvertFormat(inputPath, outputPath string, quality int) error {
	img, _, err := DecodeFile(inputPath)
	if err != nil {
		return err
	}
	return SaveByExtension(img, outputPath, quality)
}

// ReduceQuality re-encodes a JPEG image at a lower quality to reduce file size.
func ReduceQuality(img image.Image, quality int) ([]byte, error) {
	if quality < 1 {
		quality = 1
	}
	if quality > 100 {
		quality = 100
	}
	return ToBytes(img, FormatJPEG, quality)
}

// ReduceQualityFile reads a JPEG file, re-encodes at lower quality, and saves.
func ReduceQualityFile(inputPath, outputPath string, quality int) error {
	img, _, err := DecodeFile(inputPath)
	if err != nil {
		return err
	}
	return SaveJPEG(img, outputPath, quality)
}

// ──────────────────────────────────────────────
// Composite operations
// ──────────────────────────────────────────────

// OptimizeForWeb resizes and compresses an image for web use.
// It resizes to fit within maxDim x maxDim (preserving aspect ratio),
// then encodes as JPEG at the given quality.
func OptimizeForWeb(img image.Image, maxDim int, quality int) ([]byte, error) {
	resized := Thumbnail(img, maxDim, maxDim)
	return ToBytes(resized, FormatJPEG, quality)
}

// OptimizeForWebFile reads, optimizes, and saves an image for web use.
func OptimizeForWebFile(inputPath, outputPath string, maxDim int, quality int) error {
	img, _, err := DecodeFile(inputPath)
	if err != nil {
		return err
	}
	data, err := OptimizeForWeb(img, maxDim, quality)
	if err != nil {
		return err
	}
	return os.WriteFile(outputPath, data, 0644)
}

// ──────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────

// ErrUnsupportedFormat is returned for unsupported image formats.
var ErrUnsupportedFormat = errors.New("imageutil: unsupported format")
