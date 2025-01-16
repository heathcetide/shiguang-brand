//package com.foodrecord.messaging.consumer;
//
//import org.apache.kafka.streams.KafkaStreams;
//import org.apache.kafka.streams.StreamsBuilder;
//import org.apache.kafka.streams.kstream.KStream;
//import org.apache.kafka.streams.kstream.KTable;
//import org.springframework.stereotype.Service;
//import javax.annotation.Resource;
//
//
//@Service
//public class UserStatistics {
//
//    @Resource
//    private KafkaStreams kafkaStreams;
//
//    public void startStream() {
//        StreamsBuilder builder = new StreamsBuilder();
//        KStream<String, String> stream = builder.stream("user-registration");
//
//        KTable<String, Long> countTable = stream
//                .groupBy((key, value) -> "total-registrations")
//                .count();
//
//        countTable.toStream().to("user-registration-stats");
//    }
//}
