package com.foodrecord.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.UserFeedbackDTO;
import com.foodrecord.model.entity.UserFeedback;
import com.foodrecord.service.UserFeedbackService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/feedback")
public class UserFeedbackController {

    @Resource
    private UserFeedbackService feedbackService;

    @GetMapping("/food/{foodId}")
    public ApiResponse<List<UserFeedback>> getByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(feedbackService.getByFoodId(foodId));
    }

    @GetMapping("/food/{foodId}/page")
    public ApiResponse<IPage<UserFeedback>> getPageByFoodId(
            @PathVariable Long foodId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ApiResponse.success(feedbackService.getPageByFoodId(foodId, page, size));
    }

    @GetMapping("/user/{userId}")
    public ApiResponse<List<UserFeedback>> getByUserId(@PathVariable Long userId) {
        return ApiResponse.success(feedbackService.getByUserId(userId));
    }

    @GetMapping("/food/{foodId}/rating")
    public ApiResponse<Double> getAvgRating(@PathVariable Long foodId) {
        return ApiResponse.success(feedbackService.getAvgRatingByFoodId(foodId));
    }

    @PostMapping("/user/{userId}")
    public ApiResponse<UserFeedback> createFeedback(
            @PathVariable Long userId,
            @Valid @RequestBody UserFeedbackDTO dto) {
        return ApiResponse.success(feedbackService.createFeedback(userId, dto));
    }

    @PutMapping("/user/{userId}/{feedbackId}")
    public ApiResponse<UserFeedback> updateFeedback(
            @PathVariable Long userId,
            @PathVariable Long feedbackId,
            @Valid @RequestBody UserFeedbackDTO dto) {
        return ApiResponse.success(feedbackService.updateFeedback(userId, feedbackId, dto));
    }

    @DeleteMapping("/user/{userId}/{feedbackId}")
    public ApiResponse<Boolean> deleteFeedback(
            @PathVariable Long userId,
            @PathVariable Long feedbackId) {
        feedbackService.deleteFeedback(userId, feedbackId);
        return ApiResponse.success(true);
    }
} 