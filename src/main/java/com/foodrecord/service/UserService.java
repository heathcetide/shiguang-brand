package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.LoginRequest;
import com.foodrecord.model.dto.RegisterRequest;
import com.foodrecord.model.entity.User;

public interface UserService extends IService<User> {
    String login(LoginRequest request);

    User register(RegisterRequest request);

    User getUserById(Long id);

    void logout(Long userId);

    User updateUser(Long id, User updateUser);
}
