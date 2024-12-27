package com.foodrecord.recommend.service;

import com.foodrecord.recommend.model.RecommendDTO;
import com.foodrecord.recommend.model.UserBehavior;

import java.util.List;

public interface RecommendService {
    // 获取用户推荐内容
    List<RecommendDTO> getRecommendations(Long userId, int limit);
    
    // 更新用户行为数据
    void updateUserBehavior(UserBehavior behavior);
    
    // 获取热门推荐
    List<RecommendDTO> getHotRecommendations(int limit);
    
    // 获取相似用户推荐
    List<RecommendDTO> getSimilarUserRecommendations(Long userId, int limit);
    
    // 获取基于内容的推荐
    List<RecommendDTO> getContentBasedRecommendations(Long userId, int limit);
} 