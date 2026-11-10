// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package mongodb implements distributed rate limiting using MongoDB.
//
// It uses a collection with a TTL index for automatic expiry. Each
// Acquire inserts a document; if the count of documents for the key
// exceeds max within the window, the request is rejected. Documents
// auto-expire via MongoDB's TTL index.
package mongodb

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"github.com/heathcetide/DietDigiDose/pkg/common/limiter"
)

// Collection is the MongoDB collection interface required by this package.
type Collection interface {
	CountDocuments(ctx context.Context, filter interface{}, opts ...*options.CountOptions) (int64, error)
	InsertOne(ctx context.Context, document interface{}, opts ...*options.InsertOneOptions) (*mongo.InsertOneResult, error)
	DeleteOne(ctx context.Context, filter interface{}, opts ...*options.DeleteOptions) (*mongo.DeleteResult, error)
	DeleteMany(ctx context.Context, filter interface{}, opts ...*options.DeleteOptions) (*mongo.DeleteResult, error)
}

type rateLimit struct {
	col    Collection
	key    string
	max    int64
	window time.Duration
}

// NewRateLimit creates a distributed rate limiter using MongoDB.
// Each Acquire inserts a document with an expiry timestamp. MongoDB's
// TTL index automatically removes expired documents.
//
//   - col:    MongoDB collection (should have a TTL index on "expiresAt")
//   - key:    identifier for this limiter (stored in documents)
//   - max:    maximum requests in the window
//   - window: time window duration
func NewRateLimit(col Collection, key string, max int64, window time.Duration) limiter.Limiter {
	return &rateLimit{
		col:    col,
		key:    key,
		max:    max,
		window: window,
	}
}

func (l *rateLimit) Running() int {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	n, err := l.col.CountDocuments(ctx, bson.M{"limiterKey": l.key})
	if err != nil {
		return -1
	}
	return int(n)
}

func (l *rateLimit) Acquire(ctx context.Context, _ []byte) error {
	// Count current documents for this key.
	n, err := l.col.CountDocuments(ctx, bson.M{"limiterKey": l.key})
	if err != nil {
		return fmt.Errorf("mongodb limiter: count failed: %w", err)
	}
	if n >= l.max {
		return limiter.ErrLimitExceeded
	}

	// Insert a new document with expiry.
	doc := bson.M{
		"limiterKey": l.key,
		"createdAt":  time.Now(),
		"expiresAt":  time.Now().Add(l.window),
	}
	if _, err := l.col.InsertOne(ctx, doc); err != nil {
		return fmt.Errorf("mongodb limiter: insert failed: %w", err)
	}
	return nil
}

func (l *rateLimit) Release(_ []byte) {
	// Rate limiter auto-expires via TTL index; Release is a no-op.
}

// ---------------------------------------------------------------
// Distributed concurrency limiter
// ---------------------------------------------------------------

type concurrencyLimit struct {
	col Collection
	key string
	max int64
}

// NewConcurrency creates a distributed concurrency limiter using MongoDB.
// Each Acquire inserts a document; Release deletes one. Documents should
// have a TTL index for safety expiry in case of process crashes.
//
//   - col: MongoDB collection
//   - key: identifier for this limiter
//   - max: maximum concurrent permits
func NewConcurrency(col Collection, key string, max int64) limiter.Limiter {
	return &concurrencyLimit{
		col: col,
		key: key,
		max: max,
	}
}

func (l *concurrencyLimit) Running() int {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	n, err := l.col.CountDocuments(ctx, bson.M{"limiterKey": l.key})
	if err != nil {
		return -1
	}
	return int(n)
}

func (l *concurrencyLimit) Acquire(ctx context.Context, _ []byte) error {
	n, err := l.col.CountDocuments(ctx, bson.M{"limiterKey": l.key})
	if err != nil {
		return fmt.Errorf("mongodb limiter: count failed: %w", err)
	}
	if n >= l.max {
		return limiter.ErrLimitExceeded
	}

	doc := bson.M{
		"limiterKey": l.key,
		"createdAt":  time.Now(),
	}
	if _, err := l.col.InsertOne(ctx, doc); err != nil {
		return fmt.Errorf("mongodb limiter: insert failed: %w", err)
	}
	return nil
}

func (l *concurrencyLimit) Release(_ []byte) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// Delete the oldest document for this key.
	l.col.DeleteOne(ctx, bson.M{"limiterKey": l.key})
}

// Reset removes all limiter state for the given key. Useful for testing.
func Reset(ctx context.Context, col Collection, key string) error {
	_, err := col.DeleteMany(ctx, bson.M{"limiterKey": key})
	return err
}
