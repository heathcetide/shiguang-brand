// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Example: OpenAI Realtime API WebSocket session.
//
// This example demonstrates how to use the realtime package to bridge a
// client WebSocket connection with the OpenAI Realtime API. It requires
// a WebSocket server (e.g. an HTTP handler that upgrades connections) to
// be running separately; here we show the bridge logic.
package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/heathcetide/DietDigiDose/pkg/relay/meter"
	"github.com/heathcetide/DietDigiDose/pkg/relay/realtime"
)

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		log.Fatal("OPENAI_API_KEY environment variable is required")
	}

	// In a real application, you would upgrade an HTTP request to a
	// WebSocket connection here. For example, using gorilla/websocket:
	//
	//   upgrader := websocket.Upgrader{}
	//   conn, err := upgrader.Upgrade(w, r, nil)
	//   if err != nil { ... }
	//
	// Then wrap it in a realtime.Session:
	//   session := realtime.NewSession(conn, realtime.SessionConfig{
	//       Model: "gpt-4o-realtime-preview",
	//       Modalities: []string{"text", "audio"},
	//       InputAudioFormat: "pcm16",
	//       OutputAudioFormat: "pcm16",
	//       Voice: "alloy",
	//       APIKey: apiKey,
	//   })
	//   session.SetMeter(meter.NewMemoryMeter(), "openai")
	//   connector := realtime.NewOpenAIConnector(apiKey, "gpt-4o-realtime-preview")
	//   if err := session.Connect(context.Background(), connector); err != nil {
	//       log.Printf("realtime session ended: %v", err)
	//   }

	// For this example, we just print the configuration.
	cfg := realtime.SessionConfig{
		Model:             "gpt-4o-realtime-preview",
		Modalities:        []string{"text", "audio"},
		InputAudioFormat:  "pcm16",
		OutputAudioFormat: "pcm16",
		Voice:             "alloy",
		APIKey:            apiKey,
	}
	fmt.Printf("Realtime session config: model=%s modalities=%v\n", cfg.Model, cfg.Modalities)
	fmt.Println("In production, upgrade an HTTP request to WebSocket and use realtime.NewSession + Connect.")

	_ = meter.NewMemoryMeter() // referenced for import

	// Wait for signal.
	sigC := make(chan os.Signal, 1)
	signal.Notify(sigC, syscall.SIGINT, syscall.SIGTERM)
	<-sigC
}
