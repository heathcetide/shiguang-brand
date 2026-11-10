// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: AGPL-3.0

// Package vad provides production-grade voice activity detection for Go.
//
// # Engines
//
// Four engines implement the unified [Detector] interface:
//
//   - [EngineEnergy]: RMS + ZCR energy-based detector. Pure Go, zero
//     dependencies, lowest latency (~1µs/frame). Best for clean signals,
//     barge-in detection, and high-concurrency scenarios.
//   - [EngineWebRTC]: WebRTC GMM speech model (via CGO). Low latency
//     (~2µs/frame), better speech/noise discrimination than energy.
//   - [EngineSilero]: Silero VAD neural network (pure Go, embedded
//     weights, no CGO). Best discrimination — tones and noise don't
//     trigger it. ~1.4ms/frame. 16kHz only.
//   - [EngineHybrid]: Energy pre-filter + Silero confirmation. For silence
//     frames (60% of typical audio), uses Energy at ~1µs. For speech
//     candidates, falls through to Silero for accurate classification.
//     Average ~0.56ms/frame with zero accuracy loss vs pure Silero.
//     Recommended for production real-time conversations.
//
// # Quick start
//
// Create a detector and wrap it in a [Streamer] for state-machine events:
//
//	det, _ := vad.NewDetector(vad.EngineSilero, vad.DefaultConfig())
//	stream := vad.NewStreamer(det, vad.DefaultConfig())
//	defer stream.Close()
//
//	// Feed PCM16 LE frames from your audio source
//	go func() {
//		for {
//			result, _ := stream.ProcessFrame(pcmFrame)
//			_ = result
//		}
//	}()
//
//	// Consume speech events from another goroutine
//	for ev := range stream.Events() {
//		switch ev.Type {
//		case vad.EventSpeechStart:
//			log.Println("speech started")
//		case vad.EventSpeechEnd:
//			log.Println("speech ended")
//		}
//	}
//
// # Barge-in (legacy API)
//
// For SIP/telephony barge-in (detecting user interruption during TTS
// playback), use [EnergyDetector] directly:
//
//	det := vad.NewEnergyDetector()
//	if det.CheckBargeIn(pcmFrame, ttsIsPlaying) {
//	    // user is speaking — stop TTS
//	}
//
// # Factory
//
// Use [NewDetector] or [NewStreamerWithConfig] to create detectors by
// engine kind with a unified [Config].
package vad
