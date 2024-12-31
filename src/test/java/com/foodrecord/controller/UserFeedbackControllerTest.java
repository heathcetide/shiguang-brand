package com.foodrecord.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.controller.user.UserFeedbackController;
//import com.foodrecord.dto.FeedbackDTO;
import com.foodrecord.service.UserFeedbackService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.http.MediaType;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(UserFeedbackController.class)
class UserFeedbackControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private UserFeedbackService feedbackService;

    @Autowired
    private ObjectMapper objectMapper;

//    @Test
//    void shouldSubmitFeedbackSuccessfully() throws Exception {
//        // Given
//        FeedbackDTO feedbackDTO = new FeedbackDTO();
//        feedbackDTO.setUserId(1L);
//        feedbackDTO.setContent("Great app!");
//        feedbackDTO.setRating(5);
//
//        Feedback savedFeedback = new Feedback();
//        savedFeedback.setId(1L);
//        savedFeedback.setContent("Great app!");
//
//        when(feedbackService.submitFeedback(any(FeedbackDTO.class)))
//            .thenReturn(savedFeedback);
//
//        // When & Then
//        mockMvc.perform(post("/api/feedback")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(feedbackDTO)))
//                .andExpect(status().isCreated())
//                .andExpect(jsonPath("$.id").value(1))
//                .andExpect(jsonPath("$.content").value("Great app!"));
//    }
//
//    @Test
//    void shouldGetUserFeedbackHistory() throws Exception {
//        // Given
//        Long userId = 1L;
//        List<Feedback> feedbackList = Arrays.asList(
//            new Feedback(1L, userId, "Feedback 1", 4),
//            new Feedback(2L, userId, "Feedback 2", 5)
//        );
//
//        when(feedbackService.getUserFeedbackHistory(userId))
//            .thenReturn(feedbackList);
//
//        // When & Then
//        mockMvc.perform(get("/api/feedback/user/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$", hasSize(2)))
//                .andExpect(jsonPath("$[0].content").value("Feedback 1"))
//                .andExpect(jsonPath("$[1].content").value("Feedback 2"));
//    }
//
//    @Test
//    void shouldHandleInvalidFeedbackSubmission() throws Exception {
//        // Given
//        FeedbackDTO invalidFeedback = new FeedbackDTO();
//        // Missing required fields
//
//        // When & Then
//        mockMvc.perform(post("/api/feedback")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(invalidFeedback)))
//                .andExpect(status().isBadRequest())
//                .andExpect(jsonPath("$.errors").exists());
//    }
//
//    @Test
//    void shouldHandleFeedbackSubmissionFailure() throws Exception {
//        // Given
//        FeedbackDTO feedbackDTO = new FeedbackDTO();
//        feedbackDTO.setUserId(1L);
//        feedbackDTO.setContent("Test feedback");
//
//        when(feedbackService.submitFeedback(any(FeedbackDTO.class)))
//            .thenThrow(new ServiceException("Failed to save feedback"));
//
//        // When & Then
//        mockMvc.perform(post("/api/feedback")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(feedbackDTO)))
//                .andExpect(status().isInternalServerError())
//                .andExpect(jsonPath("$.message")
//                    .value("Failed to save feedback"));
//    }
}
