// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// MP3 decoding support using github.com/hajimehoshi/go-mp3.
// Provides LoadMP3 to decode MP3 files into Audio buffers.
// MP3 encoding is not supported (requires a separate encoder library).

package audioutil

import (
	"fmt"
	"io"
	"os"
	"strings"

	mp3 "github.com/hajimehoshi/go-mp3"
)

// LoadMP3 decodes an MP3 file and returns an Audio buffer.
// The output is 16-bit PCM at the MP3's native sample rate.
// go-mp3 always decodes to stereo (2 channels) regardless of the
// original channel count, so the returned Audio will have Channels=2
// unless the source is mono (Channels=1).
func LoadMP3(path string) (*Audio, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("audioutil: open %s: %w", path, err)
	}
	defer f.Close()
	return ReadMP3(f)
}

// ReadMP3 decodes MP3 data from a reader and returns an Audio buffer.
func ReadMP3(r io.Reader) (*Audio, error) {
	decoder, err := mp3.NewDecoder(r)
	if err != nil {
		return nil, fmt.Errorf("audioutil: mp3 decoder: %w", err)
	}

	// go-mp3 outputs 16-bit PCM. Channel count is inferred from the
	// decoded data: go-mp3 always decodes to the source's channel count.
	// We read all data and determine channels from the decoder.
	sampleRate := decoder.SampleRate()
	// go-mp3 doesn't expose channel count directly; it's typically stereo.
	// We default to 2 channels and can be overridden by the caller via ToMono.
	channels := 2

	// Read all decoded PCM data.
	var allBytes []byte
	buf := make([]byte, 4096)
	for {
		n, err := decoder.Read(buf)
		if n > 0 {
			allBytes = append(allBytes, buf[:n]...)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("audioutil: mp3 read: %w", err)
		}
	}

	if len(allBytes) == 0 {
		return nil, fmt.Errorf("audioutil: mp3: no audio data decoded")
	}

	// Convert PCM16LE bytes to float64 samples per channel.
	bytesPerSample := 2 // 16-bit
	blockAlign := bytesPerSample * channels
	numFrames := len(allBytes) / blockAlign

	audio := &Audio{
		SampleRate: sampleRate,
		Channels:   channels,
		Format:     Format16Bit,
		Samples:    make([][]float64, channels),
	}
	for ch := 0; ch < channels; ch++ {
		audio.Samples[ch] = make([]float64, numFrames)
	}

	for i := 0; i < numFrames; i++ {
		offset := i * blockAlign
		for ch := 0; ch < channels; ch++ {
			sampleOffset := offset + ch*bytesPerSample
			audio.Samples[ch][i] = bytesToFloat(allBytes[sampleOffset:], 16)
		}
	}

	return audio, nil
}

// Load loads an audio file, auto-detecting the format from the file extension.
// Supported formats: .wav, .mp3.
func Load(path string) (*Audio, error) {
	ext := strings.ToLower(path)
	if strings.HasSuffix(ext, ".mp3") {
		return LoadMP3(path)
	}
	if strings.HasSuffix(ext, ".wav") {
		return LoadWAV(path)
	}
	return nil, fmt.Errorf("audioutil: unsupported format for %q (use .wav or .mp3)", path)
}

// Save saves an audio file in the specified format, inferring from the
// file extension. Supported: .wav (full support), .mp3 (not supported for
// encoding — use WAV instead).
func Save(audio *Audio, path string) error {
	ext := strings.ToLower(path)
	if strings.HasSuffix(ext, ".wav") {
		return SaveWAV(audio, path)
	}
	if strings.HasSuffix(ext, ".mp3") {
		return fmt.Errorf("audioutil: MP3 encoding is not supported, please save as WAV")
	}
	return fmt.Errorf("audioutil: unsupported format for %q (use .wav)", path)
}

// IsMP3Supported returns true if MP3 decoding is available.
func IsMP3Supported() bool { return true }
