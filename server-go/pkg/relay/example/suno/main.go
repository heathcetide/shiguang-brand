// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Example: Suno music generation task submission and polling.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	relay "github.com/heathcetide/DietDigiDose/pkg/relay"
	"github.com/heathcetide/DietDigiDose/pkg/relay/meter"
)

func main() {
	baseURL := os.Getenv("SUNO_BASE_URL")
	if baseURL == "" {
		log.Fatal("SUNO_BASE_URL environment variable is required")
	}
	apiKey := os.Getenv("SUNO_API_KEY")
	if apiKey == "" {
		log.Fatal("SUNO_API_KEY environment variable is required")
	}

	client := relay.New(
		relay.WithMeter(meter.NewMemoryMeter()),
	)

	ctx := context.Background()

	// Submit a music generation task.
	resp, err := client.SubmitSunoTask(ctx, baseURL, apiKey, relay.SunoActionMusic, &relay.SunoSubmitRequest{
		GptDescriptionPrompt: "A happy jazz song about coding",
		MakeInstrumental:     false,
	})
	if err != nil {
		log.Fatalf("submit failed: %v", err)
	}
	fmt.Printf("Submit: code=%d data=%s\n", resp.Code, resp.Data)

	if resp.Code != 200 {
		log.Fatalf("submit error: %s", resp.Message)
	}

	taskID := resp.Data

	// Poll for task status.
	for i := 0; i < 10; i++ {
		time.Sleep(10 * time.Second)
		tasks, err := client.FetchSunoTask(ctx, baseURL, apiKey, []string{taskID})
		if err != nil {
			log.Printf("fetch error: %v", err)
			continue
		}
		for _, t := range tasks {
			fmt.Printf("Task: id=%s status=%s finishTime=%d\n", t.TaskID, t.Status, t.FinishTime)
			if t.Status == "SUCCESS" {
				fmt.Printf("Done! Data: %s\n", string(t.Data))
				return
			}
		}
	}
	fmt.Println("Task still processing after polling.")
}
