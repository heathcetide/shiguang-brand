// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Example: Gemini native format chat completion.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	relay "github.com/heathcetide/DietDigiDose/pkg/relay"
	"github.com/heathcetide/DietDigiDose/pkg/relay/meter"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/gemini"
	"github.com/heathcetide/DietDigiDose/pkg/relay/relaykit/dto"
)

func main() {
	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		log.Fatal("GEMINI_API_KEY environment variable is required")
	}

	client := relay.New(
		relay.WithProvider(gemini.NewProvider(apiKey)),
		relay.WithMeter(meter.NewMemoryMeter()),
	)

	req := &relay.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{
			{
				Role: "user",
				Parts: []dto.GeminiPart{
					{Text: "Hello, what is 2+2?"},
				},
			},
		},
	}

	resp, err := client.GeminiChat(context.Background(), req, "gemini-2.0-flash")
	if err != nil {
		log.Fatalf("GeminiChat failed: %v", err)
	}

	respJSON, _ := json.MarshalIndent(resp, "", "  ")
	fmt.Printf("Response: %s\n", respJSON)
}
