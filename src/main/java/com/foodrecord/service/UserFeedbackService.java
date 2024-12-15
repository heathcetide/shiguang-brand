package com.foodrecord.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.UserFeedbackDTO;
import com.foodrecord.model.entity.UserFeedback;

import java.util.List;

public interface UserFeedbackService extends IService<UserFeedback> {

    IPage<UserFeedback> getPageByFoodId(Long foodId, int page, int size);

    List<UserFeedback> getByFoodId(Long foodId);

    List<UserFeedback> getByUserId(Long userId);

    Double getAvgRatingByFoodId(Long foodId);

    UserFeedback createFeedback(Long userId, UserFeedbackDTO dto);

    UserFeedback updateFeedback(Long userId, Long feedbackId, UserFeedbackDTO dto);

    void deleteFeedback(Long userId, Long feedbackId);
}
