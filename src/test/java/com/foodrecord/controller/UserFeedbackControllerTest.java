package com.foodrecord.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.controller.user.UserFeedbackController;
import com.foodrecord.model.dto.UserFeedbackDTO;
import com.foodrecord.model.entity.UserFeedback;
import com.foodrecord.service.UserFeedbackService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class UserFeedbackControllerTest {

    @InjectMocks
    private UserFeedbackController userFeedbackController;

    @Mock
    private UserFeedbackService userFeedbackService;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
    }

    @Test
    void testGetByFoodId() {
        Long foodId = 1L;
        List<UserFeedback> mockFeedbacks = Arrays.asList(
                new UserFeedback(1L, 1L, foodId, 5, "Great food!", null, null),
                new UserFeedback(2L, 2L, foodId, 4, "Good taste.", null, null)
        );

        when(userFeedbackService.getByFoodId(foodId)).thenReturn(mockFeedbacks);

        ApiResponse<List<UserFeedback>> response = userFeedbackController.getByFoodId(foodId);

        assertEquals(2, response.getData().size());
        assertEquals("Great food!", response.getData().get(0).getComment());
        verify(userFeedbackService, times(1)).getByFoodId(foodId);
    }

    @Test
    void testGetPageByFoodId() {
        Long foodId = 1L;
        IPage<UserFeedback> mockPage = new Page<>(1, 10);
        mockPage.setRecords(Collections.singletonList(
                new UserFeedback(1L, 1L, foodId, 5, "Excellent!", null, null)
        ));

        when(userFeedbackService.getPageByFoodId(foodId, 1, 10)).thenReturn(mockPage);

        ApiResponse<IPage<UserFeedback>> response = userFeedbackController.getPageByFoodId(foodId, 1, 10);

        assertEquals(1, response.getData().getRecords().size());
        assertEquals("Excellent!", response.getData().getRecords().get(0).getComment());
        verify(userFeedbackService, times(1)).getPageByFoodId(foodId, 1, 10);
    }

    @Test
    void testGetByUserId() {
        Long userId = 1L;
        List<UserFeedback> mockFeedbacks = Arrays.asList(
                new UserFeedback(1L, userId, 1L, 5, "Awesome!", null, null)
        );

        when(userFeedbackService.getByUserId(userId)).thenReturn(mockFeedbacks);

        ApiResponse<List<UserFeedback>> response = userFeedbackController.getByUserId(userId);

        assertEquals(1, response.getData().size());
        assertEquals("Awesome!", response.getData().get(0).getComment());
        verify(userFeedbackService, times(1)).getByUserId(userId);
    }

    @Test
    void testGetAvgRating() {
        Long foodId = 1L;
        Double mockAvgRating = 4.5;

        when(userFeedbackService.getAvgRatingByFoodId(foodId)).thenReturn(mockAvgRating);

        ApiResponse<Double> response = userFeedbackController.getAvgRating(foodId);

        assertEquals(mockAvgRating, response.getData());
        verify(userFeedbackService, times(1)).getAvgRatingByFoodId(foodId);
    }

    @Test
    void testCreateFeedback() {
        Long userId = 1L;
        UserFeedbackDTO dto = new UserFeedbackDTO(1L, 5, "Amazing!");
        UserFeedback mockFeedback = new UserFeedback(1L, userId, 1L, 5, "Amazing!", null, null);

        when(userFeedbackService.createFeedback(eq(userId), any(UserFeedbackDTO.class))).thenReturn(mockFeedback);

        ApiResponse<UserFeedback> response = userFeedbackController.createFeedback(userId, dto);
        assertEquals(mockFeedback.getComment(), response.getData().getComment());
        verify(userFeedbackService, times(1)).createFeedback(eq(userId), any(UserFeedbackDTO.class));
    }

    @Test
    void testUpdateFeedback() {
        Long userId = 1L;
        Long feedbackId = 1L;
        UserFeedbackDTO dto = new UserFeedbackDTO(1L, 4, "Updated comment");
        UserFeedback mockFeedback = new UserFeedback(feedbackId, userId, 1L, 4, "Updated comment", null, null);

        when(userFeedbackService.updateFeedback(eq(userId), eq(feedbackId), any(UserFeedbackDTO.class))).thenReturn(mockFeedback);

        ApiResponse<UserFeedback> response = userFeedbackController.updateFeedback(userId, feedbackId, dto);

        assertEquals(mockFeedback.getComment(), response.getData().getComment());
        verify(userFeedbackService, times(1)).updateFeedback(eq(userId), eq(feedbackId), any(UserFeedbackDTO.class));
    }

    @Test
    void testDeleteFeedback() {
        Long userId = 1L;
        Long feedbackId = 1L;

        doNothing().when(userFeedbackService).deleteFeedback(userId, feedbackId);

        ApiResponse<Boolean> response = userFeedbackController.deleteFeedback(userId, feedbackId);

        assertEquals(true, response.getData());
        verify(userFeedbackService, times(1)).deleteFeedback(userId, feedbackId);
    }
}
