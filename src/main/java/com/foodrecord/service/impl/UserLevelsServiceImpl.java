package com.foodrecord.service.impl;
import com.foodrecord.mapper.UserLevelsMapper;
import com.foodrecord.model.entity.UserLevels;
import com.foodrecord.service.UserLevelsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class UserLevelsServiceImpl implements UserLevelsService {
    @Autowired
    private UserLevelsMapper userLevelsMapper;

    @Override
    public void addUserLevel(UserLevels userLevel) {
        userLevelsMapper.insert(userLevel);
    }

    @Override
    public UserLevels getUserLevelById(Long id) {
        return userLevelsMapper.selectById(id);
    }

    @Override
    public UserLevels getUserLevelsByUserId(Long userId) {
        return userLevelsMapper.selectByUserId(userId);
    }

    @Override
    public List<UserLevels> getAllUserLevels() {
        return userLevelsMapper.selectAll();
    }

    @Override
    public void updateUserLevel(UserLevels userLevel) {
        userLevelsMapper.update(userLevel);
    }

    @Override
    public void deleteUserLevel(Long id) {
        userLevelsMapper.delete(id);
    }
}
