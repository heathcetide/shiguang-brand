//package com.foodrecord.common.risk.notification;
//
//import org.springframework.http.HttpEntity;
//import org.springframework.http.HttpHeaders;
//import org.springframework.http.MediaType;
//import org.springframework.stereotype.Component;
//import org.springframework.web.client.RestTemplate;
//
//import javax.annotation.Resource;
//import java.util.HashMap;
//import java.util.Map;
//
//@Component
//public class WebhookNotificationChannel implements NotificationChannel {
//
//    @Resource
//    private RestTemplate restTemplate;
//
//    private final String webhookUrl = "http://example.com/webhook";
//
//    @Override
//    public void send(String content) {
//        HttpHeaders headers = new HttpHeaders();
//        headers.setContentType(MediaType.APPLICATION_JSON);
//
//        Map<String, String> body = new HashMap<>();
//        body.put("content", content);
//
//        HttpEntity<Map<String, String>> request = new HttpEntity<>(body, headers);
//        restTemplate.postForEntity(webhookUrl, request, String.class);
//    }
//
//    @Override
//    public boolean isAvailable() {
//        return true;
//    }
//
//    @Override
//    public String getChannelType() {
//        return "webhook";
//    }
//}