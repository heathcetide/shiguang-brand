package com.foodrecord.consumer;//package com.foodrecord.consumer;
//
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.kafka.core.KafkaTemplate;
//import org.springframework.stereotype.Controller;
//import org.springframework.web.bind.annotation.RequestMapping;
//import org.springframework.web.bind.annotation.ResponseBody;
//
//@Controller
//@RequestMapping("kafka")
//public class KafkaSender {
//
//    @Autowired
//    private KafkaTemplate<String, String> kafkaTemplate;
//
//    //发送消息方法
//    @RequestMapping("/send")
//    @ResponseBody
//    public String send() {
//        kafkaTemplate.send("topic", "cetide");
//        return "success";
//    }
//}