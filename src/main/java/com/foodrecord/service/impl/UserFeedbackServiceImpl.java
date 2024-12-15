package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.UserFeedbackMapper;
import com.foodrecord.model.dto.UserFeedbackDTO;
import com.foodrecord.model.entity.UserFeedback;
import com.foodrecord.service.UserFeedbackService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.List;

@Service
public class UserFeedbackServiceImpl extends ServiceImpl<UserFeedbackMapper, UserFeedback> implements UserFeedbackService {
    @Resource
    private UserFeedbackMapper feedbackMapper;
    @Resource
    private RedisUtils redisUtils;
    
    private static final String FEEDBACK_CACHE_KEY = "feedback:food:";
    private static final String AVG_RATING_CACHE_KEY = "avg_rating:food:";
    private static final long CACHE_TIME = 3600; // 1小时

    public IPage<UserFeedback> getPageByFoodId(Long foodId, int page, int size) {
        return feedbackMapper.selectPageByFoodId(new Page<>(page, size), foodId);
    }

    public List<UserFeedback> getByFoodId(Long foodId) {
        String key = FEEDBACK_CACHE_KEY + foodId;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (List<UserFeedback>) cached;
        }
        
        List<UserFeedback> feedbacks = feedbackMapper.selectByFoodId(foodId);
        redisUtils.set(key, feedbacks, CACHE_TIME);
        return feedbacks;
    }

    public List<UserFeedback> getByUserId(Long userId) {
        return feedbackMapper.selectByUserId(userId);
    }

    public Double getAvgRatingByFoodId(Long foodId) {
        String key = AVG_RATING_CACHE_KEY + foodId;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (Double) cached;
        }
        
        Double avgRating = feedbackMapper.selectAvgRatingByFoodId(foodId);
        if (avgRating != null) {
            redisUtils.set(key, avgRating, CACHE_TIME);
        }
        return avgRating;
    }

    @Transactional
    public UserFeedback createFeedback(Long userId, UserFeedbackDTO dto) {
        UserFeedback feedback = new UserFeedback();
        feedback.setUserId(userId);
        feedback.setFoodId(dto.getFoodId());
        feedback.setRating(dto.getRating());
        feedback.setComment(dto.getComment());
        
        save(feedback);
        
        // 清除相关缓存
        redisUtils.delete(FEEDBACK_CACHE_KEY + dto.getFoodId());
        redisUtils.delete(AVG_RATING_CACHE_KEY + dto.getFoodId());
        
        return feedback;
    }

    @Transactional
    public UserFeedback updateFeedback(Long userId, Long feedbackId, UserFeedbackDTO dto) {
        UserFeedback feedback = getById(feedbackId);
        if (feedback == null) {
            throw new CustomException("反馈不存在");
        }
        if (!feedback.getUserId().equals(userId)) {
            throw new CustomException("无权修改此反馈");
        }

        feedback.setRating(dto.getRating());
        feedback.setComment(dto.getComment());
        
        updateById(feedback);
        
        // 清除相关缓存
        redisUtils.delete(FEEDBACK_CACHE_KEY + feedback.getFoodId());
        redisUtils.delete(AVG_RATING_CACHE_KEY + feedback.getFoodId());
        
        return feedback;
    }

    @Transactional
    public void deleteFeedback(Long userId, Long feedbackId) {
        UserFeedback feedback = getById(feedbackId);
        if (feedback == null) {
            throw new CustomException("反馈不存在");
        }
        if (!feedback.getUserId().equals(userId)) {
            throw new CustomException("无权删除此反馈");
        }

        removeById(feedbackId);
        
        // 清除相关缓存
        redisUtils.delete(FEEDBACK_CACHE_KEY + feedback.getFoodId());
        redisUtils.delete(AVG_RATING_CACHE_KEY + feedback.getFoodId());
    }
} 