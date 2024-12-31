package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.NotificationDTO;
//import com.foodrecord.dto.NotificationSettingsDTO;
//import com.foodrecord.service.NotificationService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.http.MediaType;
//import org.springframework.test.web.servlet.MockMvc;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import java.util.Arrays;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(NotificationController.class)
//class NotificationControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private NotificationService notificationService;
//
//    @Test
//    void shouldGetUserNotifications() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(notificationService.getUserNotifications(userId))
//            .thenReturn(Arrays.asList(createNotificationDTO()));
//
//        // When & Then
//        mockMvc.perform(get("/api/notifications/user/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$[0].message").exists());
//    }
//
//    @Test
//    void shouldUpdateNotificationSettings() throws Exception {
//        // Given
//        Long userId = 1L;
//        NotificationSettingsDTO settings = createNotificationSettings();
//        when(notificationService.updateSettings(eq(userId), any()))
//            .thenReturn(settings);
//
//        // When & Then
//        mockMvc.perform(put("/api/notifications/settings/{userId}", userId)
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(settings)))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.emailEnabled").value(true));
//    }
//
//    @Test
//    void shouldMarkNotificationAsRead() throws Exception {
//        // Given
//        Long notificationId = 1L;
//        doNothing().when(notificationService).markAsRead(notificationId);
//
//        // When & Then
//        mockMvc.perform(put("/api/notifications/{id}/read", notificationId))
//                .andExpect(status().isOk());
//    }
//
//    @Test
//    void shouldDeleteNotification() throws Exception {
//        // Given
//        Long notificationId = 1L;
//        doNothing().when(notificationService).deleteNotification(notificationId);
//
//        // When & Then
//        mockMvc.perform(delete("/api/notifications/{id}", notificationId))
//                .andExpect(status().isNoContent());
//    }
//
//    private NotificationDTO createNotificationDTO() {
//        return NotificationDTO.builder()
//            .id(1L)
//            .userId(1L)
//            .message("Time for lunch!")
//            .type(NotificationType.MEAL_REMINDER)
//            .read(false)
//            .build();
//    }
//
//    private NotificationSettingsDTO createNotificationSettings() {
//        return NotificationSettingsDTO.builder()
//            .emailEnabled(true)
//            .pushEnabled(true)
//            .mealReminders(true)
//            .weeklyReports(true)
//            .build();
//    }
//}