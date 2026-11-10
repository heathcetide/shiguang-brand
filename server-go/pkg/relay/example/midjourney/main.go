// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Example: Midjourney task submission and polling.
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	relay "github.com/heathcetide/DietDigiDose/pkg/relay"
	"github.com/heathcetide/DietDigiDose/pkg/relay/meter"
	relaymode "github.com/heathcetide/DietDigiDose/pkg/relay/relaymode"
)

func main() {
	baseURL := os.Getenv("MJ_BASE_URL")
	if baseURL == "" {
		log.Fatal("MJ_BASE_URL environment variable is required")
	}
	apiKey := os.Getenv("MJ_API_KEY")
	if apiKey == "" {
		log.Fatal("MJ_API_KEY environment variable is required")
	}

	client := relay.New(
		relay.WithMeter(meter.NewMemoryMeter()),
	)

	ctx := context.Background()

	// Submit an imagine task.
	resp, err := client.MidjourneySubmit(ctx, baseURL, apiKey, relaymode.RelayModeMidjourneyImagine, &relay.MidjourneyRequest{
		Prompt: "A cute cat in space suit, digital art",
	})
	if err != nil {
		log.Fatalf("submit failed: %v", err)
	}
	fmt.Printf("Submit: code=%d result=%s\n", resp.Code, resp.Result)

	if resp.Code != 1 {
		log.Fatalf("submit error: %s", resp.Description)
	}

	taskID := resp.Result

	// Poll for task status.
	task, err := client.MidjourneyFetch(ctx, baseURL, apiKey, taskID)
	if err != nil {
		log.Fatalf("fetch failed: %v", err)
	}
	fmt.Printf("Task: id=%s status=%s progress=%s\n", task.ID, task.Status, task.Progress)
	if task.ImageUrl != "" {
		fmt.Printf("Image URL: %s\n", task.ImageUrl)
	}
}
