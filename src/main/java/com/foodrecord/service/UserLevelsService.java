package com.foodrecord.service;

import com.foodrecord.model.entity.UserLevels;

import java.util.List;

public interface UserLevelsService {

    void addUserLevel(UserLevels userLevel);
    UserLevels getUserLevelById(Long id);
    UserLevels getUserLevelsByUserId(Long userId);
    List<UserLevels> getAllUserLevels();
    void updateUserLevel(UserLevels userLevel);
    void deleteUserLevel(Long id);
}
