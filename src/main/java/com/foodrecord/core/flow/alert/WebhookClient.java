package com.foodrecord.core.flow.alert;

import com.foodrecord.controller.user.UserController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class WebhookClient {
    private final RestTemplate restTemplate;
    private final AlertProperties alertProperties;
    private static final Logger logger = LoggerFactory.getLogger(UserController.class);
    public WebhookClient(RestTemplate restTemplate, AlertProperties alertProperties) {
        this.restTemplate = restTemplate;
        this.alertProperties = alertProperties;
    }
    
    public void sendAlert(Alert alert) {
        try {
            restTemplate.postForEntity(
                alertProperties.getWebhookUrl(),
                createWebhookPayload(alert),
                String.class
            );
        } catch (Exception e) {
            logger.error("Failed to send webhook alert", e);
        }
    }
    
    private WebhookPayload createWebhookPayload(Alert alert) {
        WebhookPayload webhookPayload = new WebhookPayload();
        webhookPayload.setTitle("Flow Alert: " + alert.getType());
        webhookPayload.setLevel(alert.getType().toString());
        webhookPayload.setTimestamp(alert.getTimestamp());
//        webhookPayload.setContext(alert.getContext());
        return webhookPayload;
    }
} 