package com.foodrecord.config;

import org.apache.kafka.streams.KafkaStreams;
import org.apache.kafka.streams.StreamsBuilder;
import org.apache.kafka.streams.StreamsConfig;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Properties;

@Configuration
public class KafkaStreamsConfig {

    @Bean
    public KafkaStreams kafkaStreams() {
        // Kafka Streams 配置
        Properties props = new Properties();
        props.put(StreamsConfig.APPLICATION_ID_CONFIG, "food-streams-app");
        props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "8.137.22.105:9092");
        props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, "org.apache.kafka.common.serialization.Serdes$StringSerde");
        props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, "org.apache.kafka.common.serialization.Serdes$StringSerde");

        // 构建流
        StreamsBuilder builder = new StreamsBuilder();
        builder.stream("food-input-topic").to("food-output-topic");

        // 初始化 Kafka Streams
        return new KafkaStreams(builder.build(), props);
    }
}