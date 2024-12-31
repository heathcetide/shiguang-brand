package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.Notification;
//import com.foodrecord.dto.NotificationDTO;
//import com.foodrecord.repository.NotificationRepository;
//import com.foodrecord.mapper.NotificationMapper;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDateTime;
//import java.util.Arrays;
//import java.util.List;
//import java.util.Optional;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class NotificationServiceTest {
//
//    @Mock
//    private NotificationRepository notificationRepository;
//
//    @Mock
//    private NotificationMapper notificationMapper;
//
//    @Mock
//    private EmailService emailService;
//
//    @InjectMocks
//    private NotificationServiceImpl notificationService;
//
//    @Test
//    void shouldCreateNotification() {
//        // Given
//        NotificationDTO notificationDTO = createNotificationDTO();
//        Notification notification = createNotification();
//        when(notificationMapper.toEntity(notificationDTO)).thenReturn(notification);
//        when(notificationRepository.save(any())).thenReturn(notification);
//        when(notificationMapper.toDTO(notification)).thenReturn(notificationDTO);
//
//        // When
//        NotificationDTO result = notificationService.createNotification(notificationDTO);
//
//        // Then
//        assertThat(result).isNotNull();
//        verify(notificationRepository).save(any());
//        verify(emailService).sendNotificationEmail(any());
//    }
//
//    @Test
//    void shouldGetUserNotifications() {
//        // Given
//        Long userId = 1L;
//        List<Notification> notifications = Arrays.asList(createNotification());
//        when(notificationRepository.findByUserIdOrderByCreatedAtDesc(userId))
//            .thenReturn(notifications);
//        when(notificationMapper.toDTO(any())).thenReturn(createNotificationDTO());
//
//        // When
//        List<NotificationDTO> results = notificationService.getUserNotifications(userId);
//
//        // Then
//        assertThat(results).hasSize(1);
//        verify(notificationRepository).findByUserIdOrderByCreatedAtDesc(userId);
//    }
//
//    @Test
//    void shouldMarkNotificationAsRead() {
//        // Given
//        Long notificationId = 1L;
//        Notification notification = createNotification();
//        when(notificationRepository.findById(notificationId))
//            .thenReturn(Optional.of(notification));
//
//        // When
//        notificationService.markAsRead(notificationId);
//
//        // Then
//        verify(notificationRepository).save(argThat(n -> n.isRead()));
//    }
//
//    @Test
//    void shouldHandleNotificationNotFound() {
//        // Given
//        Long notificationId = 999L;
//        when(notificationRepository.findById(notificationId))
//            .thenReturn(Optional.empty());
//
//        // When & Then
//        assertThatThrownBy(() -> notificationService.markAsRead(notificationId))
//            .isInstanceOf(NotificationNotFoundException.class);
//    }
//
//    private NotificationDTO createNotificationDTO() {
//        return NotificationDTO.builder()
//            .userId(1L)
//            .message("Time for lunch!")
//            .type(NotificationType.MEAL_REMINDER)
//            .read(false)
//            .build();
//    }
//
//    private Notification createNotification() {
//        return Notification.builder()
//            .id(1L)
//            .userId(1L)
//            .message("Time for lunch!")
//            .type(NotificationType.MEAL_REMINDER)
//            .read(false)
//            .createdAt(LocalDateTime.now())
//            .build();
//    }
//}