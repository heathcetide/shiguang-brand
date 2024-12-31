package com.foodrecord.core.flow.alert;

import com.foodrecord.controller.user.UserController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

import static com.foodrecord.core.flow.alert.Alert.Type.ERROR;
import static com.foodrecord.core.flow.alert.AlertRule.AlertLevel.*;

@Component
public class AlertNotifier {
    private final JavaMailSender mailSender;
    private final WebhookClient webhookClient;
    private final AlertProperties alertProperties;
    private static final Logger logger = LoggerFactory.getLogger(UserController.class);
    
    public AlertNotifier(JavaMailSender mailSender, 
                        WebhookClient webhookClient,
                        AlertProperties alertProperties) {
        this.mailSender = mailSender;
        this.webhookClient = webhookClient;
        this.alertProperties = alertProperties;
    }
    
    public void sendAlert(Alert alert) {
        switch (alert.getType()) {
            case SECURITY:
                sendEmailAlert(alert);
                break;
            case SYSTEM:
                sendEmailAlert(alert);
                sendWebhookAlert(alert);
                break;
            case ERROR:
            case PERFORMANCE:
                sendEmailAlert(alert);
                sendWebhookAlert(alert);
                sendSmsAlert(alert);
                break;
        }
    }

    private void sendEmailAlert(Alert alert) {
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setTo(alertProperties.getAdminEmail());
            message.setSubject("Flow Alert: " + alert.getType());
            message.setText(alert.getMessage());
            mailSender.send(message);
        } catch (Exception e) {
            logger.error("Failed to send email alert", e);
        }
    }
    
    private void sendWebhookAlert(Alert alert) {
        webhookClient.sendAlert(alert);
    }
    
    private void sendSmsAlert(Alert alert) {
        // TODO: 实现短信告警
        logger.info("SMS alert not implemented yet: {}", alert.getMessage());
    }
} 