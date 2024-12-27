package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.Friendship;

import java.util.List;
import java.util.Map;

/**
* @author Lenovo
* @description 针对表【friendship】的数据库操作Service
* @createDate 2024-12-02 21:47:52
*/
public interface FriendshipsService extends IService<Friendship> {
    
    /**
     * 发送好友请求
     */
    ApiResponse<String> sendFriendRequest(Long userId, Long friendId, String message);
    
    /**
     * 获取好友列表
     */
    ApiResponse<List<Map<String, Object>>> getFriendList(Long userId, String filter);
    
    /**
     * 批量处理好友请求
     */
    ApiResponse<String> batchProcessRequests(Long userId, List<Long> requestIds, Integer operation);
    
    /**
     * 获取共同好友
     */
    ApiResponse<List<Map<String, Object>>> getMutualFriends(Long userId1, Long userId2);
    
    /**
     * 获取好友推荐
     */
    ApiResponse<List<Map<String, Object>>> getRecommendedFriends(Long userId, Integer limit);
    
    /**
     * 获取好友数量
     */
    int getFriendCount(Long userId);
    
    /**
     * 获取待处理请求数量
     */
    int getPendingRequestCount(Long userId);
    
    /**
     * 接受好友请求
     */
    ApiResponse<String> acceptFriendRequest(Long requestId);
    
    /**
     * 拒绝好友请求
     */
    ApiResponse<String> rejectFriendRequest(Long requestId);
    
    /**
     * 删除好友
     */
    ApiResponse<Boolean> deleteFriend(Long userId, Long friendId);
    
    /**
     * 获取待处理的好友请求
     */
    ApiResponse<List<Map<String, Object>>> getPendingRequests(Long userId);
    
    /**
     * 获取好友关系状态
     */
    ApiResponse<Integer> getFriendshipStatus(Long userId, Long friendId);
    
    /**
     * 取消好友请求
     */
    ApiResponse<String> cancelFriendRequest(Long userId, Long friendId);
    
    /**
     * 屏蔽用户
     */
    ApiResponse<String> blockUser(Long userId, Long friendId);
}
