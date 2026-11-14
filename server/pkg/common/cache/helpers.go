package cache

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// GetString is a convenience wrapper around ByteCache.Get.
func GetString(ctx context.Context, c ByteCache, key string) (string, error) {
	b, err := c.Get(ctx, key)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// SetString is a convenience wrapper around ByteCache.Set.
func SetString(ctx context.Context, c ByteCache, key, value string, ttl time.Duration) error {
	return c.Set(ctx, key, []byte(value), ttl)
}

// GetJSON unmarshals a cached JSON value into dest.
func GetJSON(ctx context.Context, c ByteCache, key string, dest any) error {
	b, err := c.Get(ctx, key)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, dest)
}

// SetJSON marshals value as JSON and stores it.
func SetJSON(ctx context.Context, c ByteCache, key string, value any, ttl time.Duration) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.Set(ctx, key, b, ttl)
}

// GetOrSet returns the cached value for key, or calls fn to produce and store it.
func GetOrSet(ctx context.Context, c ByteCache, key string, ttl time.Duration, fn func(context.Context) ([]byte, error)) ([]byte, error) {
	if fn == nil {
		return nil, ErrNotFound
	}
	if val, err := c.Get(ctx, key); err == nil {
		return val, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	val, err := fn(ctx)
	if err != nil {
		return nil, err
	}
	if err := c.Set(ctx, key, val, ttl); err != nil {
		return nil, err
	}
	return val, nil
}
