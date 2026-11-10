// Copyright (c) 2026 LingByte. All rights reserved.
// SPDX-License-Identifier: MIT

// Package factory provides a unified entry point for creating message-queue
// brokers. It imports all supported backends and exposes a single NewBroker
// function that dispatches to the appropriate implementation based on the
// BrokerType in the config.
//
// # Supported backends
//
//   - rabbitmq    — RabbitMQ via amqp091-go
//   - kafka       — Kafka via segmentio/kafka-go
//   - rocketmq    — RocketMQ via apache/rocketmq-client-go/v2
//   - activemq    — ActiveMQ via go-stomp/stomp (STOMP protocol)
//   - redisstream — Redis Streams via go-redis
//
// # Usage
//
//	import (
//	    "github.com/heathcetide/DietDigiDose/pkg/common/mq"
//	    "github.com/LingByte/ling-base/common/mq/factory"
//	    "github.com/heathcetide/DietDigiDose/pkg/common/mq/rabbitmq"
//	)
//
//	broker, err := factory.NewBroker(mq.BrokerConfig{
//	    Type:         mq.BrokerRabbitMQ,
//	    RabbitMQConfig: &rabbitmq.Config{URL: "amqp://guest:guest@localhost:5672/"},
//	})
//	if err != nil { panic(err) }
//	defer broker.Close()
//
//	// Use broker with the unified mq.Broker interface.
//	producer, _ := broker.Producer("events", mq.PublishOptions{})
//	_ = producer.Publish(ctx, &mq.Message{Body: []byte("hello")})
package factory

import (
	"fmt"

	"github.com/heathcetide/DietDigiDose/pkg/common/mq"
	"github.com/heathcetide/DietDigiDose/pkg/common/mq/activemq"
	"github.com/heathcetide/DietDigiDose/pkg/common/mq/kafka"
	"github.com/heathcetide/DietDigiDose/pkg/common/mq/rabbitmq"
	"github.com/heathcetide/DietDigiDose/pkg/common/mq/redisstream"
	"github.com/heathcetide/DietDigiDose/pkg/common/mq/rocketmq"
)

// NewBroker creates a broker of the type specified in cfg.
// The appropriate backend-specific config field must be populated.
//
// Returns an error if the type is unsupported or the required config
// field is nil/invalid.
func NewBroker(cfg mq.BrokerConfig) (mq.Broker, error) {
	switch cfg.Type {
	case mq.BrokerRabbitMQ:
		return newRabbitMQ(cfg)

	case mq.BrokerKafka:
		return newKafka(cfg)

	case mq.BrokerRocketMQ:
		return newRocketMQ(cfg)

	case mq.BrokerActiveMQ:
		return newActiveMQ(cfg)

	case mq.BrokerRedisStream:
		return newRedisStream(cfg)

	default:
		return nil, fmt.Errorf("factory: unsupported broker type %q", cfg.Type)
	}
}

// ============================================================
// Backend constructors
// ============================================================

func newRabbitMQ(cfg mq.BrokerConfig) (mq.Broker, error) {
	if cfg.RabbitMQConfig == nil {
		return nil, fmt.Errorf("factory: RabbitMQConfig is required for %q", cfg.Type)
	}
	rcfg, ok := cfg.RabbitMQConfig.(*rabbitmq.Config)
	if !ok {
		return nil, fmt.Errorf("factory: RabbitMQConfig must be *rabbitmq.Config, got %T", cfg.RabbitMQConfig)
	}
	return rabbitmq.New(*rcfg)
}

func newKafka(cfg mq.BrokerConfig) (mq.Broker, error) {
	if cfg.KafkaConfig == nil {
		return nil, fmt.Errorf("factory: KafkaConfig is required for %q", cfg.Type)
	}
	kcfg, ok := cfg.KafkaConfig.(*kafka.Config)
	if !ok {
		return nil, fmt.Errorf("factory: KafkaConfig must be *kafka.Config, got %T", cfg.KafkaConfig)
	}
	return kafka.New(*kcfg)
}

func newRocketMQ(cfg mq.BrokerConfig) (mq.Broker, error) {
	if cfg.RocketMQConfig == nil {
		return nil, fmt.Errorf("factory: RocketMQConfig is required for %q", cfg.Type)
	}
	rmcfg, ok := cfg.RocketMQConfig.(*rocketmq.Config)
	if !ok {
		return nil, fmt.Errorf("factory: RocketMQConfig must be *rocketmq.Config, got %T", cfg.RocketMQConfig)
	}
	return rocketmq.New(*rmcfg)
}

func newActiveMQ(cfg mq.BrokerConfig) (mq.Broker, error) {
	if cfg.ActiveMQConfig == nil {
		return nil, fmt.Errorf("factory: ActiveMQConfig is required for %q", cfg.Type)
	}
	amcfg, ok := cfg.ActiveMQConfig.(*activemq.Config)
	if !ok {
		return nil, fmt.Errorf("factory: ActiveMQConfig must be *activemq.Config, got %T", cfg.ActiveMQConfig)
	}
	return activemq.New(*amcfg)
}

func newRedisStream(cfg mq.BrokerConfig) (mq.Broker, error) {
	if cfg.RedisStreamConfig == nil {
		return nil, fmt.Errorf("factory: RedisStreamConfig is required for %q", cfg.Type)
	}
	rscfg, ok := cfg.RedisStreamConfig.(*redisstream.Config)
	if !ok {
		return nil, fmt.Errorf("factory: RedisStreamConfig must be *redisstream.Config, got %T", cfg.RedisStreamConfig)
	}
	return redisstream.New(*rscfg)
}

// ============================================================
// Backend info
// ============================================================

// BackendInfo returns capability information for a broker type.
func BackendInfo(typ mq.BrokerType) mq.BackendInfo {
	switch typ {
	case mq.BrokerRabbitMQ:
		return mq.BackendInfo{
			Type: mq.BrokerRabbitMQ, Name: "RabbitMQ",
			Persistent: true, Ordered: true, Transaction: true,
			ConsumerGroup: false, PubSub: true,
		}
	case mq.BrokerKafka:
		return mq.BackendInfo{
			Type: mq.BrokerKafka, Name: "Kafka",
			Persistent: true, Ordered: true, Transaction: true,
			ConsumerGroup: true, PubSub: true,
		}
	case mq.BrokerRocketMQ:
		return mq.BackendInfo{
			Type: mq.BrokerRocketMQ, Name: "RocketMQ",
			Persistent: true, Ordered: true, Transaction: true,
			ConsumerGroup: true, PubSub: true,
		}
	case mq.BrokerActiveMQ:
		return mq.BackendInfo{
			Type: mq.BrokerActiveMQ, Name: "ActiveMQ",
			Persistent: true, Ordered: true, Transaction: false,
			ConsumerGroup: false, PubSub: true,
		}
	case mq.BrokerRedisStream:
		return mq.BackendInfo{
			Type: mq.BrokerRedisStream, Name: "Redis Streams",
			Persistent: true, Ordered: true, Transaction: false,
			ConsumerGroup: true, PubSub: false,
		}
	default:
		return mq.BackendInfo{Type: typ, Name: "unknown"}
	}
}

// AllBackendInfo returns capability info for all supported backends.
func AllBackendInfo() []mq.BackendInfo {
	result := make([]mq.BackendInfo, 0, len(mq.SupportedBrokers))
	for _, typ := range mq.SupportedBrokers {
		result = append(result, BackendInfo(typ))
	}
	return result
}
