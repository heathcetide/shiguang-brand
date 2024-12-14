package com.foodrecord.controller;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterRequest;
import com.foodrecord.model.entity.User;
import com.foodrecord.service.impl.UserServiceImpl;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/users")
public class UserController {
    private final UserServiceImpl userService;

    public UserController(UserServiceImpl userService) {
        this.userService = userService;
    }

    @PostMapping("/login")
    public ApiResponse<Map<String, String>> login(@Valid @RequestBody LoginRequest request) {
        String token = userService.login(request);
        Map<String, String> response = new HashMap<>();
        response.put("token", token);
        return ApiResponse.success(response);
    }

    @PostMapping("/register")
    public ApiResponse<User> register(@Valid @RequestBody RegisterRequest request) {
        User user = userService.register(request);
        user.setPassword(null); // 不返回密码
        return ApiResponse.success(user);
    }
} 