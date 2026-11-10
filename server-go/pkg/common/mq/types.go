// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

package mq

// BrokerType identifies a message-queue backend implementation.
type BrokerType string

const (
	// BrokerRabbitMQ selects a RabbitMQ backend.
	BrokerRabbitMQ BrokerType = "rabbitmq"
	// BrokerKafka selects a Kafka backend.
	BrokerKafka BrokerType = "kafka"
	// BrokerRocketMQ selects a RocketMQ backend.
	BrokerRocketMQ BrokerType = "rocketmq"
	// BrokerActiveMQ selects an ActiveMQ backend (STOMP protocol).
	BrokerActiveMQ BrokerType = "activemq"
	// BrokerRedisStream selects a Redis Streams backend.
	BrokerRedisStream BrokerType = "redisstream"
)

// String returns the broker type as a string.
func (t BrokerType) String() string { return string(t) }

// ============================================================
// Unified BrokerConfig
// ============================================================

// BrokerConfig is a union config that carries backend-specific settings.
// The factory selects the appropriate field based on BrokerType.
//
// Usage:
//
//	cfg := mq.BrokerConfig{
//	    Type:       mq.BrokerRabbitMQ,
//	    RabbitMQ:   &rabbitmq.Config{URL: "amqp://..."},
//	}
//	broker, err := factory.NewBroker(cfg)
type BrokerConfig struct {
	Type BrokerType

	// RabbitMQ configuration. Required when Type == BrokerRabbitMQ.
	RabbitMQConfig any // *rabbitmq.Config

	// Kafka configuration. Required when Type == BrokerKafka.
	KafkaConfig any // *kafka.Config

	// RocketMQ configuration. Required when Type == BrokerRocketMQ.
	RocketMQConfig any // *rocketmq.Config

	// ActiveMQ configuration. Required when Type == BrokerActiveMQ.
	ActiveMQConfig any // *activemq.Config

	// RedisStream configuration. Required when Type == BrokerRedisStream.
	RedisStreamConfig any // *redisstream.Config
}

// ============================================================
// Common backend capabilities
// ============================================================

// BackendInfo describes a backend implementation's capabilities.
type BackendInfo struct {
	Type          BrokerType
	Name          string
	Persistent    bool // survives broker restart
	Ordered       bool // preserves message ordering
	Transaction   bool // supports transactions
	ConsumerGroup bool // supports consumer groups
	PubSub        bool // supports pub/sub pattern
}

// SupportedBrokers lists all broker types the factory can create.
var SupportedBrokers = []BrokerType{
	BrokerRabbitMQ,
	BrokerKafka,
	BrokerRocketMQ,
	BrokerActiveMQ,
	BrokerRedisStream,
}

// IsSupported reports whether the given broker type has a registered
// factory function.
func IsSupported(t BrokerType) bool {
	for _, b := range SupportedBrokers {
		if b == t {
			return true
		}
	}
	return false
}
