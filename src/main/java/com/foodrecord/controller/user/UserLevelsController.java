package com.foodrecord.controller.user;

import com.foodrecord.model.entity.UserLevels;
import com.foodrecord.service.UserLevelsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/userLevels")
public class UserLevelsController {
    @Autowired
    private UserLevelsService userLevelsService;

    @PostMapping
    public void addUserLevel(@RequestBody UserLevels userLevel) {
        userLevelsService.addUserLevel(userLevel);
    }

    @GetMapping("/{id}")
    public UserLevels getUserLevelById(@PathVariable Long id) {
        return userLevelsService.getUserLevelById(id);
    }

    @GetMapping("/user/{userId}")
    public UserLevels getUserLevelsByUserId(@PathVariable Long userId) {
        return userLevelsService.getUserLevelsByUserId(userId);
    }

    @GetMapping
    public List<UserLevels> getAllUserLevels() {
        return userLevelsService.getAllUserLevels();
    }

    @PutMapping("/{id}")
    public void updateUserLevel(@PathVariable Long id, @RequestBody UserLevels userLevel) {
        userLevel.setId(id);
        userLevelsService.updateUserLevel(userLevel);
    }

    @DeleteMapping("/{id}")
    public void deleteUserLevel(@PathVariable Long id) {
        userLevelsService.deleteUserLevel(id);
    }
}
