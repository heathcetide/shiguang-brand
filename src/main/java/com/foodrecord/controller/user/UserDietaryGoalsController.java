package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.UserDietaryGoalsDTO;
import com.foodrecord.model.entity.UserDietaryGoals;
import com.foodrecord.service.impl.UserDietaryGoalsServiceImpl;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/dietary-goals")
public class UserDietaryGoalsController {
    private final UserDietaryGoalsServiceImpl goalsService;

    public UserDietaryGoalsController(UserDietaryGoalsServiceImpl goalsService) {
        this.goalsService = goalsService;
    }

    @GetMapping("/user/{userId}")
    public ApiResponse<UserDietaryGoals> getByUserId(@PathVariable Long userId) {
        return ApiResponse.success(goalsService.getByUserId(userId));
    }

    @PostMapping("/user/{userId}")
    public ApiResponse<UserDietaryGoals> createOrUpdate(
            @PathVariable Long userId,
            @Valid @RequestBody UserDietaryGoalsDTO dto) {
        return ApiResponse.success(goalsService.createOrUpdate(userId, dto));
    }
} 