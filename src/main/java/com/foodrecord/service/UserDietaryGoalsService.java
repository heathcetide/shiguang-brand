package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.UserDietaryGoalsDTO;
import com.foodrecord.model.entity.UserDietaryGoals;

public interface UserDietaryGoalsService extends IService<UserDietaryGoals> {
    UserDietaryGoals getByUserId(Long userId);

    UserDietaryGoals createOrUpdate(Long userId, UserDietaryGoalsDTO dto);
}
