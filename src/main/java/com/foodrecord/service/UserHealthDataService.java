package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.UserHealthDataDTO;
import com.foodrecord.model.entity.UserHealthData;

public interface UserHealthDataService extends IService<UserHealthData> {

    UserHealthData getUserHealthData(Long userId);

    UserHealthData createUserHealthData(Long userId, UserHealthDataDTO healthDataDTO);

    UserHealthData updateUserHealthData(Long userId, UserHealthDataDTO healthDataDTO);


}
