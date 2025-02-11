package com.foodrecord.notification;

import com.foodrecord.model.entity.Notification;
import com.foodrecord.model.entity.User;
import com.foodrecord.model.enums.NotificationLevel;
import com.foodrecord.notification.impl.EmailSendNotification;
import com.foodrecord.notification.impl.SmsSendNotification;
import com.foodrecord.notification.impl.InAppNotification;
import com.foodrecord.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

@SpringBootTest
@TestPropertySource("classpath:application-test.yml")
class SendNotificationTest {

    @Autowired
    private SendNotification sendNotificationImpl;

    @Mock
    private UserService userService;

    @Mock
    private NotificationService notificationService;

    @Mock
    private JavaMailSender mailSender;

    @Mock
    private EmailSendNotification emailSendNotification;

    @Mock
    private SmsSendNotification smsSendNotification;

    @Mock
    private InAppNotification inAppNotification;

    private User testUser;
    private Notification testNotification;

    @BeforeEach
    void setUp() {
        // 初始化测试数据
        testUser = new User();
        testUser.setId(1L);
        testUser.setEmail("2148582258@qq.com");

        testNotification = new Notification();
        testNotification.setUserId(testUser.getId());
        testNotification.setTitle("Test Notification");
        testNotification.setContent("This is a test notification content.");
        testNotification.setLevel(NotificationLevel.NORMAL);
    }

    @Test
    void testSendMessage_singleUser_emailStrategy() throws Exception {
        // Arrange
        sendNotificationImpl.setSendNotifyStrategy(emailSendNotification);

        // Mock UserService to return test user
        when(userService.getById(testNotification.getUserId())).thenReturn(testUser);

        // Mock the email sending logic
        doNothing().when(emailSendNotification).send(any(Notification.class));

        // Act
        sendNotificationImpl.sendMessage(testNotification.getContent(), testUser.getId());

        // Assert
        ArgumentCaptor<Notification> notificationCaptor = ArgumentCaptor.forClass(Notification.class);
        verify(emailSendNotification, times(1)).send(notificationCaptor.capture());

        Notification capturedNotification = notificationCaptor.getValue();

        // 你可以在此处验证捕获到的通知对象的内容
        assertEquals(testNotification.getContent(), capturedNotification.getContent());
        assertEquals(testNotification.getUserId(), capturedNotification.getUserId());
    }


//    @Test
//    void testSendMessage_multipleUsers_smsStrategy() throws Exception {
//        // Arrange
//        sendNotificationImpl.setSendNotifyStrategy(smsSendNotification);
//
//        // Mock UserService to return a list of users
//        User anotherUser = new User();
//        anotherUser.setId(2L);
//        anotherUser.setEmail("anotheruser@example.com");
//
//        List<Long> userIds = Arrays.asList(testUser.getId(), anotherUser.getId());
//
//        when(userService.getById(testNotification.getUserId())).thenReturn(testUser);
//        when(userService.getById(anotherUser.getId())).thenReturn(anotherUser);
//
//        // Mock SMS sending logic
//        doNothing().when(smsSendNotification).send(testNotification);
//
//        // Act
//        sendNotificationImpl.setMessageToUserList(testNotification.getContent(), userIds);
//
//        // Assert
//        verify(smsSendNotification, times(2)).send(testNotification);  // Verifying that send was called twice
//    }


//    @Test
//    void testSendInAppNotification() throws Exception {
//        // Arrange
//        sendNotificationImpl.setSendNotifyStrategy(inAppNotification);
//
//        // Mock the NotificationService to handle database saving
//        doNothing().when(notificationService).sendNotification(testNotification);
//
//        // Act
//        sendNotificationImpl.sendMessage(testNotification.getContent(), testUser.getId());
//
//        // Assert
//        verify(inAppNotification, times(1)).send(eq(testNotification));  // Verify that the send method was called with the expected notification
//        verify(notificationService, times(1)).sendNotification(testNotification);
//    }


    @Test
    void testSetSubjectAndPriority() throws Exception {
        // Arrange
        sendNotificationImpl.setSendNotifyStrategy(emailSendNotification);

        // Set subject and priority for the notification
        sendNotificationImpl.setSubject("Test Notification");
        sendNotificationImpl.setPriority(NotificationLevel.IMPORTANT);

        // Mock email sending logic
        doNothing().when(emailSendNotification).send(any(Notification.class));

        // Act
        sendNotificationImpl.sendMessage(testNotification.getContent(), testUser.getId());

        // Assert: Use ArgumentCaptor to capture the Notification passed to the send method
        ArgumentCaptor<Notification> notificationCaptor = ArgumentCaptor.forClass(Notification.class);
        verify(emailSendNotification, times(1)).send(notificationCaptor.capture());

        // Assert that the captured notification has the expected subject and priority
        Notification capturedNotification = notificationCaptor.getValue();
        assertEquals("Test Notification", capturedNotification.getTitle());  // Verifying the subject
        assertEquals(NotificationLevel.IMPORTANT, capturedNotification.getLevel());  // Verifying the priority
    }


    @Test
    void testSendEmailNotification() throws Exception {
        // Arrange
        sendNotificationImpl.setSendNotifyStrategy(emailSendNotification);

        // Mock email sending behavior for the send method
        doNothing().when(emailSendNotification).send(any(Notification.class));  // Mock send with Notification parameter

        // Act
        sendNotificationImpl.sendMessage("Email body", testUser.getId());  // This will call send with Notification

        // Assert
        verify(emailSendNotification, times(1)).send(any(Notification.class));  // Verify send was called once with Notification
    }

    @Test
    void testSendSmsNotification() throws Exception {
        // Arrange
        sendNotificationImpl.setSendNotifyStrategy(smsSendNotification);

        // Mock SMS sending
        doNothing().when(smsSendNotification).send(any(Notification.class));  // Expect Notification

        // Act
        sendNotificationImpl.sendMessage("SMS body", testUser.getId());

        // Assert
        verify(smsSendNotification, times(1)).send(any(Notification.class));
    }
}
