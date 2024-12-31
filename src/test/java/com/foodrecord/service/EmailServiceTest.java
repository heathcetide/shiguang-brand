package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.dto.EmailDTO;
//import com.foodrecord.config.EmailProperties;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import org.springframework.mail.javamail.JavaMailSender;
//import org.springframework.mail.SimpleMailMessage;
//import org.thymeleaf.spring5.SpringTemplateEngine;
//import org.thymeleaf.context.Context;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class EmailServiceTest {
//
//    @Mock
//    private JavaMailSender mailSender;
//
//    @Mock
//    private SpringTemplateEngine templateEngine;
//
//    @Mock
//    private EmailProperties emailProperties;
//
//    @InjectMocks
//    private EmailServiceImpl emailService;
//
//    @Test
//    void shouldSendWelcomeEmail() {
//        // Given
//        String to = "user@example.com";
//        String name = "Test User";
//        when(emailProperties.getFrom()).thenReturn("noreply@foodrecord.com");
//        when(templateEngine.process(eq("welcome"), any(Context.class)))
//            .thenReturn("Welcome content");
//
//        // When
//        emailService.sendWelcomeEmail(to, name);
//
//        // Then
//        verify(mailSender).send(any(SimpleMailMessage.class));
//    }
//
//    @Test
//    void shouldSendNotificationEmail() {
//        // Given
//        EmailDTO emailDTO = createNotificationEmailDTO();
//        when(emailProperties.getFrom()).thenReturn("noreply@foodrecord.com");
//        when(templateEngine.process(eq("notification"), any(Context.class)))
//            .thenReturn("Notification content");
//
//        // When
//        emailService.sendNotificationEmail(emailDTO);
//
//        // Then
//        verify(mailSender).send(any(SimpleMailMessage.class));
//    }
//
//    @Test
//    void shouldSendWeeklyReport() {
//        // Given
//        String to = "user@example.com";
//        byte[] reportContent = "Report content".getBytes();
//        when(emailProperties.getFrom()).thenReturn("noreply@foodrecord.com");
//
//        // When
//        emailService.sendWeeklyReport(to, reportContent);
//
//        // Then
//        verify(mailSender).send(any(MimeMessage.class));
//    }
//
//    @Test
//    void shouldHandleEmailError() {
//        // Given
//        String to = "invalid@example";
//        when(mailSender.send(any(SimpleMailMessage.class)))
//            .thenThrow(new MailSendException("Failed to send"));
//
//        // When & Then
//        assertThatThrownBy(() -> emailService.sendWelcomeEmail(to, "Test"))
//            .isInstanceOf(EmailSendException.class);
//    }
//
//    private EmailDTO createNotificationEmailDTO() {
//        return EmailDTO.builder()
//            .to("user@example.com")
//            .subject("Meal Reminder")
//            .templateName("notification")
//            .variables(Map.of(
//                "userName", "Test User",
//                "message", "Time for lunch!"
//            ))
//            .build();
//    }
//}