//package com.foodrecord.config;
//
//import org.apache.kafka.streams.KafkaStreams;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.context.event.ContextRefreshedEvent;
//import org.springframework.context.event.EventListener;
//import org.springframework.stereotype.Component;
//
//@Component
//public class KafkaStreamsStarter {
//
//    @Autowired
//    private KafkaStreams kafkaStreams;
//
//    @EventListener(ContextRefreshedEvent.class)
//    public void startKafkaStreams() {
//        kafkaStreams.start();
//        Runtime.getRuntime().addShutdownHook(new Thread(kafkaStreams::close));
//    }
//}