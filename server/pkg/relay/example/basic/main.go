// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Example: basic chat completion with OpenAI provider and usage metering.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	relay "github.com/heathcetide/DietDigiDose/pkg/relay"
	"github.com/heathcetide/DietDigiDose/pkg/relay/meter"
	"github.com/heathcetide/DietDigiDose/pkg/relay/channel/openai"
)

func main() {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		log.Fatal("OPENAI_API_KEY environment variable is required")
	}

	// Create a client with OpenAI provider and in-memory meter.
	client := relay.New(
		relay.WithProvider(openai.NewProvider(apiKey)),
		relay.WithMeter(meter.NewMemoryMeter()),
	)

	ctx := context.Background()

	// Send a chat completion request.
	resp, err := client.Chat(ctx, &relay.ChatRequest{
		Model: "gpt-4o-mini",
		Messages: []relay.Message{
			{Role: "user", Content: "Say hello in one sentence."},
		},
	})
	if err != nil {
		log.Fatalf("chat failed: %v", err)
	}

	// Print the response.
	if len(resp.Choices) > 0 {
		fmt.Printf("Response: %v\n", resp.Choices[0].Message.Content)
	}
	fmt.Printf("Usage: %+v\n", resp.Usage)

	// Query aggregated usage stats.
	stats, err := client.Meter().Query(ctx, nil)
	if err != nil {
		log.Fatalf("query failed: %v", err)
	}
	fmt.Printf("\nAggregated stats:\n")
	fmt.Printf("  Total records: %d\n", stats.TotalRecords)
	fmt.Printf("  Total input tokens: %d\n", stats.TotalUsage.InputTokens)
	fmt.Printf("  Total output tokens: %d\n", stats.TotalUsage.OutputTokens)
	fmt.Printf("  Total cached tokens: %d\n", stats.TotalUsage.CachedTokens)

	// Aggregate by model.
	agg, err := client.Meter().Aggregate(ctx, nil, "model")
	if err != nil {
		log.Fatalf("aggregate failed: %v", err)
	}
	fmt.Printf("\nUsage by model:\n")
	for _, a := range agg {
		fmt.Printf("  %s: input=%d output=%d count=%d\n",
			a.Key, a.Usage.InputTokens, a.Usage.OutputTokens, a.Count)
	}

	// Pretty-print the response as JSON.
	jsonData, _ := json.MarshalIndent(resp, "", "  ")
	fmt.Printf("\nFull response JSON:\n%s\n", jsonData)
}
