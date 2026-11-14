// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// WebP encoding support, backed by github.com/deepteams/webp (pure Go, no
// CGo, zero external dependencies). The decoder registered by
// golang.org/x/image/webp in imageutil.go remains in use for reading.

package imageutil

import (
	"image"
	"io"

	"github.com/deepteams/webp"
)

// encodeWebP encodes img to w as WebP. quality follows the convention used
// across imageutil:
//   - quality in [1, 100]: lossy encoding (higher = better quality, larger file)
//   - quality <= 0:        lossless encoding
//
// The encoder uses Method=4 (good compression/speed balance) and sharp YUV
// sampling for crisp chroma edges.
func encodeWebP(w io.Writer, img image.Image, quality int) error {
	opts := &webp.EncoderOptions{
		Method: 4,
	}
	if quality <= 0 {
		opts.Lossless = true
		// For lossless, Quality controls compression effort, not visual quality.
		if q := float32(-quality); q > 0 {
			opts.Quality = q
		} else {
			opts.Quality = 75
		}
	} else {
		if quality > 100 {
			quality = 100
		}
		opts.Quality = float32(quality)
	}
	return webp.Encode(w, img, opts)
}
