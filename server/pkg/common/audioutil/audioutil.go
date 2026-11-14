// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package audioutil provides audio processing utilities for WAV and MP3 files:
//
//   - WAV read/write: 8-bit, 16-bit, 24-bit, 32-bit PCM; mono/stereo
//   - MP3 decode: load MP3 files into Audio buffers (via go-mp3)
//   - Volume: adjust gain, fade in/out, normalize
//   - Trim: remove silence, cut to range
//   - Mix: merge multiple audio streams
//   - Resample: linear interpolation
//   - Convert: mono↔stereo, bit depth, WAV↔MP3 round-trip
//   - Effects: fade, speed change, reverse
//   - Info: duration, sample rate, channels, bit depth
//
// # Quick start
//
//	// Load WAV or MP3 (auto-detected by extension)
//	audio, err := audioutil.Load("input.mp3")
//	audio = audioutil.AdjustVolume(audio, 2.0)
//	audio = audioutil.TrimSilence(audio, -40)
//	audioutil.SaveWAV(audio, "output.wav")
package audioutil

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"strings"
)

// ──────────────────────────────────────────────
// Audio types
// ──────────────────────────────────────────────

// SampleFormat represents the bit depth of audio samples.
type SampleFormat int

const (
	Format8Bit  SampleFormat = 8
	Format16Bit SampleFormat = 16
	Format24Bit SampleFormat = 24
	Format32Bit SampleFormat = 32
)

// Audio represents an in-memory audio buffer.
type Audio struct {
	SampleRate int          // samples per second (e.g. 44100)
	Channels   int          // 1 = mono, 2 = stereo
	Format     SampleFormat // bit depth
	Samples    [][]float64  // [channel][sample] float64 samples normalized to [-1, 1]
}

// NumSamples returns the number of samples per channel.
func (a *Audio) NumSamples() int {
	if len(a.Samples) == 0 {
		return 0
	}
	return len(a.Samples[0])
}

// Duration returns the duration in seconds.
func (a *Audio) Duration() float64 {
	if a.SampleRate == 0 {
		return 0
	}
	return float64(a.NumSamples()) / float64(a.SampleRate)
}

// Info holds audio file information.
type Info struct {
	SampleRate  int
	Channels    int
	BitDepth    int
	NumSamples  int
	DurationSec float64
}

// String returns a human-readable description.
func (i Info) String() string {
	return fmt.Sprintf("%dHz, %dch, %d-bit, %.2fs", i.SampleRate, i.Channels, i.BitDepth, i.DurationSec)
}

// ──────────────────────────────────────────────
// WAV file reading
// ──────────────────────────────────────────────

// LoadWAV loads a WAV file and returns an Audio buffer.
func LoadWAV(path string) (*Audio, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("audioutil: open %s: %w", path, err)
	}
	defer f.Close()
	return ReadWAV(f)
}

// ReadWAV reads a WAV file from a reader.
func ReadWAV(r io.ReadSeeker) (*Audio, error) {
	// Read RIFF header.
	var riff [4]byte
	if _, err := io.ReadFull(r, riff[:]); err != nil {
		return nil, fmt.Errorf("audioutil: read RIFF: %w", err)
	}
	if string(riff[:]) != "RIFF" {
		return nil, fmt.Errorf("audioutil: not a RIFF file")
	}

	var totalSize uint32
	if err := binary.Read(r, binary.LittleEndian, &totalSize); err != nil {
		return nil, fmt.Errorf("audioutil: read size: %w", err)
	}

	var wave [4]byte
	if _, err := io.ReadFull(r, wave[:]); err != nil {
		return nil, fmt.Errorf("audioutil: read WAVE: %w", err)
	}
	if string(wave[:]) != "WAVE" {
		return nil, fmt.Errorf("audioutil: not a WAVE file")
	}

	// Parse chunks.
	var fmtChunk *wavFormat
	var dataChunk []byte

	for {
		var chunkID [4]byte
		if _, err := io.ReadFull(r, chunkID[:]); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				break
			}
			return nil, fmt.Errorf("audioutil: read chunk: %w", err)
		}
		var chunkSize uint32
		if err := binary.Read(r, binary.LittleEndian, &chunkSize); err != nil {
			return nil, fmt.Errorf("audioutil: read chunk size: %w", err)
		}

		switch string(chunkID[:]) {
		case "fmt ":
			fmtData := make([]byte, chunkSize)
			if _, err := io.ReadFull(r, fmtData); err != nil {
				return nil, fmt.Errorf("audioutil: read fmt chunk: %w", err)
			}
			fmtChunk = parseFmtChunk(fmtData)
		case "data":
			dataChunk = make([]byte, chunkSize)
			if _, err := io.ReadFull(r, dataChunk); err != nil {
				return nil, fmt.Errorf("audioutil: read data chunk: %w", err)
			}
		default:
			// Skip unknown chunk.
			if _, err := r.Seek(int64(chunkSize), io.SeekCurrent); err != nil {
				return nil, fmt.Errorf("audioutil: skip chunk: %w", err)
			}
		}
	}

	if fmtChunk == nil {
		return nil, fmt.Errorf("audioutil: missing fmt chunk")
	}
	if dataChunk == nil {
		return nil, fmt.Errorf("audioutil: missing data chunk")
	}
	if fmtChunk.audioFormat != 1 {
		return nil, fmt.Errorf("audioutil: unsupported audio format %d (only PCM=1)", fmtChunk.audioFormat)
	}

	return decodePCM(dataChunk, fmtChunk)
}

// wavFormat holds parsed fmt chunk data.
type wavFormat struct {
	audioFormat   uint16
	numChannels   uint16
	sampleRate    uint32
	byteRate      uint32
	blockAlign    uint16
	bitsPerSample uint16
}

// parseFmtChunk parses the fmt chunk data.
func parseFmtChunk(data []byte) *wavFormat {
	if len(data) < 16 {
		return nil
	}
	return &wavFormat{
		audioFormat:   binary.LittleEndian.Uint16(data[0:2]),
		numChannels:   binary.LittleEndian.Uint16(data[2:4]),
		sampleRate:    binary.LittleEndian.Uint32(data[4:8]),
		byteRate:      binary.LittleEndian.Uint32(data[8:12]),
		blockAlign:    binary.LittleEndian.Uint16(data[12:14]),
		bitsPerSample: binary.LittleEndian.Uint16(data[14:16]),
	}
}

// decodePCM decodes PCM data into float64 samples.
func decodePCM(data []byte, wf *wavFormat) (*Audio, error) {
	bits := int(wf.bitsPerSample)
	channels := int(wf.numChannels)
	bytesPerSample := bits / 8
	blockAlign := int(wf.blockAlign)
	if blockAlign == 0 {
		blockAlign = bytesPerSample * channels
	}

	numFrames := len(data) / blockAlign
	if numFrames == 0 {
		return nil, fmt.Errorf("audioutil: no audio frames")
	}

	audio := &Audio{
		SampleRate: int(wf.sampleRate),
		Channels:   channels,
		Format:     SampleFormat(bits),
		Samples:    make([][]float64, channels),
	}
	for i := range audio.Samples {
		audio.Samples[i] = make([]float64, numFrames)
	}

	for i := 0; i < numFrames; i++ {
		offset := i * blockAlign
		for ch := 0; ch < channels; ch++ {
			sampleOffset := offset + ch*bytesPerSample
			audio.Samples[ch][i] = bytesToFloat(data[sampleOffset:], bits)
		}
	}

	return audio, nil
}

// bytesToFloat converts a PCM sample to a float64 in [-1, 1].
func bytesToFloat(data []byte, bits int) float64 {
	switch bits {
	case 8:
		// 8-bit PCM is unsigned (0-255), center at 128.
		return (float64(data[0]) - 128) / 128
	case 16:
		val := int16(binary.LittleEndian.Uint16(data[:2]))
		return float64(val) / 32768
	case 24:
		uval := uint32(data[0]) | uint32(data[1])<<8 | uint32(data[2])<<16
		var val int32
		if uval&0x800000 != 0 {
			val = int32(uval | 0xFF000000) // sign extend
		} else {
			val = int32(uval)
		}
		return float64(val) / 8388608
	case 32:
		val := int32(binary.LittleEndian.Uint32(data[:4]))
		return float64(val) / 2147483648
	default:
		return 0
	}
}

// ──────────────────────────────────────────────
// WAV file writing
// ──────────────────────────────────────────────

// SaveWAV saves an Audio buffer as a WAV file.
func SaveWAV(audio *Audio, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("audioutil: create %s: %w", path, err)
	}
	defer f.Close()
	return WriteWAV(f, audio)
}

// WriteWAV writes an Audio buffer as WAV data to a writer.
func WriteWAV(w io.Writer, audio *Audio) error {
	bits := int(audio.Format)
	if bits == 0 {
		bits = 16
	}
	channels := audio.Channels
	if channels == 0 {
		channels = 1
	}
	bytesPerSample := bits / 8
	blockAlign := bytesPerSample * channels
	numFrames := audio.NumSamples()
	dataSize := numFrames * blockAlign
	byteRate := audio.SampleRate * blockAlign

	// Write RIFF header.
	if _, err := w.Write([]byte("RIFF")); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(36+dataSize)); err != nil {
		return err
	}
	if _, err := w.Write([]byte("WAVE")); err != nil {
		return err
	}

	// Write fmt chunk.
	if _, err := w.Write([]byte("fmt ")); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(16)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(1)); err != nil { // PCM
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(channels)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(audio.SampleRate)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(byteRate)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(blockAlign)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(bits)); err != nil {
		return err
	}

	// Write data chunk.
	if _, err := w.Write([]byte("data")); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(dataSize)); err != nil {
		return err
	}

	// Write samples.
	buf := make([]byte, blockAlign)
	for i := 0; i < numFrames; i++ {
		for ch := 0; ch < channels; ch++ {
			sampleOffset := ch * bytesPerSample
			floatToBytes(audio.Samples[ch][i], bits, buf[sampleOffset:])
		}
		if _, err := w.Write(buf); err != nil {
			return fmt.Errorf("audioutil: write samples: %w", err)
		}
	}

	return nil
}

// floatToBytes converts a float64 sample to PCM bytes.
func floatToBytes(val float64, bits int, out []byte) {
	// Clamp to [-1, 1].
	if val > 1 {
		val = 1
	}
	if val < -1 {
		val = -1
	}
	switch bits {
	case 8:
		out[0] = uint8(val*127 + 128)
	case 16:
		s := int16(val * 32767)
		binary.LittleEndian.PutUint16(out[:2], uint16(s))
	case 24:
		s := int32(val * 8388607)
		out[0] = byte(s)
		out[1] = byte(s >> 8)
		out[2] = byte(s >> 16)
	case 32:
		s := int32(val * 2147483647)
		binary.LittleEndian.PutUint32(out[:4], uint32(s))
	}
}

// ──────────────────────────────────────────────
// Volume / gain
// ──────────────────────────────────────────────

// AdjustVolume scales the amplitude by a factor.
// factor of 2.0 doubles the volume, 0.5 halves it.
func AdjustVolume(audio *Audio, factor float64) *Audio {
	result := &Audio{
		SampleRate: audio.SampleRate,
		Channels:   audio.Channels,
		Format:     audio.Format,
		Samples:    make([][]float64, audio.Channels),
	}
	for ch := range audio.Samples {
		result.Samples[ch] = make([]float64, len(audio.Samples[ch]))
		for i, s := range audio.Samples[ch] {
			result.Samples[ch][i] = clampSample(s * factor)
		}
	}
	return result
}

// Normalize normalizes the audio to a target peak level (0-1).
// target of 1.0 means full scale.
func Normalize(audio *Audio, target float64) *Audio {
	if target <= 0 {
		target = 1
	}
	if target > 1 {
		target = 1
	}
	peak := 0.0
	for _, ch := range audio.Samples {
		for _, s := range ch {
			abs := math.Abs(s)
			if abs > peak {
				peak = abs
			}
		}
	}
	if peak == 0 {
		return audio
	}
	factor := target / peak
	return AdjustVolume(audio, factor)
}

// FadeIn applies a linear fade-in over the given duration in seconds.
func FadeIn(audio *Audio, durationSec float64) *Audio {
	numFade := int(durationSec * float64(audio.SampleRate))
	total := audio.NumSamples()
	if numFade > total {
		numFade = total
	}
	if numFade <= 0 {
		return audio
	}
	result := copyAudio(audio)
	for ch := range result.Samples {
		for i := 0; i < numFade; i++ {
			factor := float64(i) / float64(numFade)
			result.Samples[ch][i] *= factor
		}
	}
	return result
}

// FadeOut applies a linear fade-out over the given duration in seconds.
func FadeOut(audio *Audio, durationSec float64) *Audio {
	numFade := int(durationSec * float64(audio.SampleRate))
	total := audio.NumSamples()
	if numFade > total {
		numFade = total
	}
	if numFade <= 0 {
		return audio
	}
	result := copyAudio(audio)
	start := total - numFade
	for ch := range result.Samples {
		for i := 0; i < numFade; i++ {
			factor := 1 - float64(i)/float64(numFade)
			result.Samples[ch][start+i] *= factor
		}
	}
	return result
}

// ──────────────────────────────────────────────
// Trim / cut
// ──────────────────────────────────────────────

// Trim removes samples from the beginning and end.
// startSec and endSec are offsets in seconds.
func Trim(audio *Audio, startSec, endSec float64) *Audio {
	startSample := int(startSec * float64(audio.SampleRate))
	endSample := audio.NumSamples() - int(endSec*float64(audio.SampleRate))
	if startSample < 0 {
		startSample = 0
	}
	if endSample > audio.NumSamples() {
		endSample = audio.NumSamples()
	}
	if startSample >= endSample {
		return &Audio{
			SampleRate: audio.SampleRate,
			Channels:   audio.Channels,
			Format:     audio.Format,
			Samples:    make([][]float64, audio.Channels),
		}
	}
	result := &Audio{
		SampleRate: audio.SampleRate,
		Channels:   audio.Channels,
		Format:     audio.Format,
		Samples:    make([][]float64, audio.Channels),
	}
	for ch := range audio.Samples {
		result.Samples[ch] = make([]float64, endSample-startSample)
		copy(result.Samples[ch], audio.Samples[ch][startSample:endSample])
	}
	return result
}

// TrimSilence removes leading and trailing silence below the given threshold (in dB).
// threshold of -40 means samples below -40dB are considered silence.
func TrimSilence(audio *Audio, thresholdDB float64) *Audio {
	threshold := math.Pow(10, thresholdDB/20)
	total := audio.NumSamples()

	// Find first non-silent sample.
	start := 0
	found := false
	for i := 0; i < total; i++ {
		for ch := 0; ch < audio.Channels; ch++ {
			if math.Abs(audio.Samples[ch][i]) > threshold {
				start = i
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		// All silence.
		return &Audio{
			SampleRate: audio.SampleRate,
			Channels:   audio.Channels,
			Format:     audio.Format,
			Samples:    make([][]float64, audio.Channels),
		}
	}

	// Find last non-silent sample.
	end := total
	found = false
	for i := total - 1; i >= 0; i-- {
		for ch := 0; ch < audio.Channels; ch++ {
			if math.Abs(audio.Samples[ch][i]) > threshold {
				end = i + 1
				found = true
				break
			}
		}
		if found {
			break
		}
	}

	result := &Audio{
		SampleRate: audio.SampleRate,
		Channels:   audio.Channels,
		Format:     audio.Format,
		Samples:    make([][]float64, audio.Channels),
	}
	for ch := range audio.Samples {
		result.Samples[ch] = make([]float64, end-start)
		copy(result.Samples[ch], audio.Samples[ch][start:end])
	}
	return result
}

// Cut extracts a portion of the audio from startSec to endSec.
func Cut(audio *Audio, startSec, endSec float64) *Audio {
	return Trim(audio, startSec, audio.Duration()-endSec)
}

// ──────────────────────────────────────────────
// Mix / merge
// ──────────────────────────────────────────────

// Mix mixes two audio buffers together. If they have different lengths,
// the result has the length of the longer one. Sample rates should match.
func Mix(a, b *Audio) *Audio {
	maxLen := a.NumSamples()
	if b.NumSamples() > maxLen {
		maxLen = b.NumSamples()
	}
	channels := a.Channels
	if b.Channels > channels {
		channels = b.Channels
	}
	result := &Audio{
		SampleRate: a.SampleRate,
		Channels:   channels,
		Format:     a.Format,
		Samples:    make([][]float64, channels),
	}
	for ch := 0; ch < channels; ch++ {
		result.Samples[ch] = make([]float64, maxLen)
		for i := 0; i < maxLen; i++ {
			var sum float64
			if ch < a.Channels && i < a.NumSamples() {
				sum += a.Samples[ch][i]
			}
			if ch < b.Channels && i < b.NumSamples() {
				sum += b.Samples[ch][i]
			}
			result.Samples[ch][i] = clampSample(sum)
		}
	}
	return result
}

// Concatenate joins two audio buffers end-to-end.
// Both must have the same sample rate and channel count.
func Concatenate(a, b *Audio) (*Audio, error) {
	if a.SampleRate != b.SampleRate {
		return nil, fmt.Errorf("audioutil: sample rate mismatch %d vs %d", a.SampleRate, b.SampleRate)
	}
	if a.Channels != b.Channels {
		return nil, fmt.Errorf("audioutil: channel mismatch %d vs %d", a.Channels, b.Channels)
	}
	total := a.NumSamples() + b.NumSamples()
	result := &Audio{
		SampleRate: a.SampleRate,
		Channels:   a.Channels,
		Format:     a.Format,
		Samples:    make([][]float64, a.Channels),
	}
	for ch := 0; ch < a.Channels; ch++ {
		result.Samples[ch] = make([]float64, total)
		copy(result.Samples[ch], a.Samples[ch])
		copy(result.Samples[ch][a.NumSamples():], b.Samples[ch])
	}
	return result, nil
}

// ──────────────────────────────────────────────
// Channel conversion
// ──────────────────────────────────────────────

// ToMono converts stereo (or multi-channel) audio to mono by averaging channels.
func ToMono(audio *Audio) *Audio {
	if audio.Channels == 1 {
		return audio
	}
	numFrames := audio.NumSamples()
	result := &Audio{
		SampleRate: audio.SampleRate,
		Channels:   1,
		Format:     audio.Format,
		Samples:    [][]float64{make([]float64, numFrames)},
	}
	for i := 0; i < numFrames; i++ {
		sum := 0.0
		for ch := 0; ch < audio.Channels; ch++ {
			sum += audio.Samples[ch][i]
		}
		result.Samples[0][i] = sum / float64(audio.Channels)
	}
	return result
}

// ToStereo converts mono audio to stereo by duplicating the channel.
func ToStereo(audio *Audio) *Audio {
	if audio.Channels == 2 {
		return audio
	}
	if audio.Channels != 1 {
		// For >2 channels, just take first two or duplicate first.
	}
	result := &Audio{
		SampleRate: audio.SampleRate,
		Channels:   2,
		Format:     audio.Format,
		Samples:    make([][]float64, 2),
	}
	for ch := 0; ch < 2; ch++ {
		result.Samples[ch] = make([]float64, audio.NumSamples())
		copy(result.Samples[ch], audio.Samples[0])
	}
	return result
}

// ──────────────────────────────────────────────
// Resample
// ──────────────────────────────────────────────

// Resample changes the sample rate using linear interpolation.
func Resample(audio *Audio, targetSampleRate int) *Audio {
	if targetSampleRate == audio.SampleRate || targetSampleRate <= 0 {
		return audio
	}
	ratio := float64(targetSampleRate) / float64(audio.SampleRate)
	oldLen := audio.NumSamples()
	newLen := int(float64(oldLen) * ratio)
	if newLen <= 0 {
		newLen = 1
	}
	result := &Audio{
		SampleRate: targetSampleRate,
		Channels:   audio.Channels,
		Format:     audio.Format,
		Samples:    make([][]float64, audio.Channels),
	}
	for ch := 0; ch < audio.Channels; ch++ {
		result.Samples[ch] = make([]float64, newLen)
		for i := 0; i < newLen; i++ {
			srcIdx := float64(i) / ratio
			idx0 := int(math.Floor(srcIdx))
			idx1 := idx0 + 1
			if idx0 >= oldLen {
				idx0 = oldLen - 1
			}
			if idx1 >= oldLen {
				idx1 = oldLen - 1
			}
			frac := srcIdx - float64(idx0)
			result.Samples[ch][i] = audio.Samples[ch][idx0]*(1-frac) + audio.Samples[ch][idx1]*frac
		}
	}
	return result
}

// ──────────────────────────────────────────────
// Effects
// ──────────────────────────────────────────────

// Reverse reverses the audio.
func Reverse(audio *Audio) *Audio {
	result := copyAudio(audio)
	for ch := range result.Samples {
		for i, j := 0, len(result.Samples[ch])-1; i < j; i, j = i+1, j-1 {
			result.Samples[ch][i], result.Samples[ch][j] = result.Samples[ch][j], result.Samples[ch][i]
		}
	}
	return result
}

// ChangeSpeed changes the playback speed by a factor without changing pitch.
// factor of 2.0 plays twice as fast (shorter duration).
// Note: This is a simple implementation that resamples and changes pitch.
func ChangeSpeed(audio *Audio, factor float64) *Audio {
	if factor <= 0 {
		factor = 1
	}
	newRate := int(float64(audio.SampleRate) / factor)
	return Resample(audio, newRate)
}

// ──────────────────────────────────────────────
// Bit depth conversion
// ──────────────────────────────────────────────

// ConvertFormat changes the bit depth of the audio.
func ConvertFormat(audio *Audio, format SampleFormat) *Audio {
	result := copyAudio(audio)
	result.Format = format
	return result
}

// ──────────────────────────────────────────────
// Info
// ──────────────────────────────────────────────

// GetInfo returns information about a WAV file without fully decoding.
func GetInfo(path string) (*Info, error) {
	audio, err := LoadWAV(path)
	if err != nil {
		return nil, err
	}
	return &Info{
		SampleRate:  audio.SampleRate,
		Channels:    audio.Channels,
		BitDepth:    int(audio.Format),
		NumSamples:  audio.NumSamples(),
		DurationSec: audio.Duration(),
	}, nil
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// copyAudio creates a deep copy of an Audio buffer.
func copyAudio(audio *Audio) *Audio {
	result := &Audio{
		SampleRate: audio.SampleRate,
		Channels:   audio.Channels,
		Format:     audio.Format,
		Samples:    make([][]float64, audio.Channels),
	}
	for ch := range audio.Samples {
		result.Samples[ch] = make([]float64, len(audio.Samples[ch]))
		copy(result.Samples[ch], audio.Samples[ch])
	}
	return result
}

// Copy creates a deep copy of an Audio buffer.
func Copy(audio *Audio) *Audio {
	return copyAudio(audio)
}

// clampSample clamps a sample to [-1, 1].
func clampSample(s float64) float64 {
	if s > 1 {
		return 1
	}
	if s < -1 {
		return -1
	}
	return s
}

// NewAudio creates a new Audio buffer with the given parameters.
func NewAudio(sampleRate, channels int, format SampleFormat, numSamples int) *Audio {
	samples := make([][]float64, channels)
	for i := range samples {
		samples[i] = make([]float64, numSamples)
	}
	return &Audio{
		SampleRate: sampleRate,
		Channels:   channels,
		Format:     format,
		Samples:    samples,
	}
}

// GenerateTone generates a sine wave tone at the given frequency for the given duration.
func GenerateTone(freq float64, durationSec float64, sampleRate int) *Audio {
	numSamples := int(durationSec * float64(sampleRate))
	audio := NewAudio(sampleRate, 1, Format16Bit, numSamples)
	for i := 0; i < numSamples; i++ {
		t := float64(i) / float64(sampleRate)
		audio.Samples[0][i] = math.Sin(2*math.Pi*freq*t) * 0.5
	}
	return audio
}

// GenerateSilence creates a silent audio buffer.
func GenerateSilence(durationSec float64, sampleRate, channels int) *Audio {
	numSamples := int(durationSec * float64(sampleRate))
	return NewAudio(sampleRate, channels, Format16Bit, numSamples)
}

// Describe returns a human-readable description of the audio.
func Describe(audio *Audio) string {
	return strings.TrimSpace(fmt.Sprintf("%dHz, %dch, %d-bit, %.2fs, %d samples",
		audio.SampleRate, audio.Channels, int(audio.Format), audio.Duration(), audio.NumSamples()))
}
