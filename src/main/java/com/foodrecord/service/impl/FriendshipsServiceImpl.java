package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.FriendshipMapper;
import com.foodrecord.model.entity.Friendship;
import com.foodrecord.service.FriendshipsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static com.foodrecord.controller.user.FriendshipsController.*;

@Service
public class FriendshipsServiceImpl extends ServiceImpl<FriendshipMapper, Friendship> implements FriendshipsService {

    @Resource
    private FriendshipMapper friendshipMapper;

    @Override
    @Transactional
    public ApiResponse<String> sendFriendRequest(Long userId, Long friendId, String message) {
        try {
            // 检查是否已经存在好友关系
            QueryWrapper<Friendship> queryWrapper = new QueryWrapper<>();
            queryWrapper.eq("user_id", userId)
                    .eq("friend_id", friendId)
                    .ne("status", STATUS_DELETED);
            
            Friendship existingFriendship = friendshipMapper.selectOneFriendship(userId, friendId);
            if (existingFriendship != null) {
                return ApiResponse.success("已经存在好友关系或待处理的请求");
            }

            // 创建新的好友请求
            Friendship friendship = new Friendship();
            friendship.setUserId(userId);
            friendship.setFriendId(friendId);
            friendship.setStatus(STATUS_PENDING);
            friendship.setMessage(message);
            friendship.setCreatedAt(new Date());
            friendship.setUpdatedAt(new Date());

            friendshipMapper.save(friendship);
            return ApiResponse.success("好友请求发送成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "发送好友请求失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse<List<Map<String, Object>>> getFriendList(Long userId, String filter) {
        try {
            QueryWrapper<Friendship> queryWrapper = new QueryWrapper<>();
            queryWrapper.eq("user_id", userId)
                    .eq("status", STATUS_ACCEPTED);
            
            if (filter != null) {
                switch (filter) {
                    case "online":
                        queryWrapper.eq("is_online", 1);
                        break;
                    case "recent":
                        queryWrapper.orderByDesc("last_interaction_time");
                        break;
                }
            }

            List<Map<String, Object>> friendList = friendshipMapper.selectFriendListWithDetails(userId);
            return ApiResponse.success(friendList);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取好友列表失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse<String> batchProcessRequests(Long userId, List<Long> requestIds, Integer operation) {
        try {
            for (Long requestId : requestIds) {
                Friendship friendship = friendshipMapper.selectById(requestId);
                if (friendship != null && friendship.getFriendId().equals(userId)) {
                    friendship.setStatus(operation);
                    friendship.setUpdatedAt(new Date());
                    friendshipMapper.updateById(friendship);
                }
            }
            return ApiResponse.success( "批量处理成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "批量处理失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse<List<Map<String, Object>>> getMutualFriends(Long userId1, Long userId2) {
        try {
            List<Map<String, Object>> mutualFriends = friendshipMapper.selectMutualFriends(userId1, userId2);
            return ApiResponse.success(mutualFriends);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取共同好友失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse<List<Map<String, Object>>> getRecommendedFriends(Long userId, Integer limit) {
        try {
            List<Map<String, Object>> recommendedFriends = friendshipMapper.selectRecommendedFriends(userId, limit);
            return ApiResponse.success(recommendedFriends);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取好友推荐失败：" + e.getMessage());
        }
    }

    @Override
    public int getFriendCount(Long userId) {
        return Math.toIntExact(friendshipMapper.selectFriendCount(userId, STATUS_ACCEPTED));
    }

    @Override
    public int getPendingRequestCount(Long userId) {
        return Math.toIntExact(friendshipMapper.selectPendingCount(userId, STATUS_PENDING));
    }

    @Override
    @Transactional
    public ApiResponse<String> acceptFriendRequest(Long requestId) {
        try {
            Friendship friendship = friendshipMapper.selectById(requestId);
            if (friendship == null || !friendship.getStatus().equals(STATUS_PENDING)) {
                return ApiResponse.success("请求不存在或已处理");
            }

            friendship.setStatus(STATUS_ACCEPTED);
            friendship.setUpdatedAt(new Date());
            friendshipMapper.updateById(friendship);

            // 创建双向好友关系
            Friendship reverseFriendship = new Friendship();
            reverseFriendship.setUserId(friendship.getFriendId());
            reverseFriendship.setFriendId(friendship.getUserId());
            reverseFriendship.setStatus(STATUS_ACCEPTED);
            reverseFriendship.setCreatedAt(new Date());
            reverseFriendship.setUpdatedAt(new Date());
            friendshipMapper.insert(reverseFriendship);

            return ApiResponse.success("已接受好友请求");
        } catch (Exception e) {
            return ApiResponse.error(300, "处理好友请求失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse<String> rejectFriendRequest(Long requestId) {
        try {
            Friendship friendship = friendshipMapper.selectById(requestId);
            if (friendship == null || !friendship.getStatus().equals(STATUS_PENDING)) {
                return ApiResponse.success("请求不存在或已处理");
            }

            friendship.setStatus(STATUS_REJECTED);
            friendship.setUpdatedAt(new Date());
            friendshipMapper.updateById(friendship);

            return ApiResponse.success( "已拒绝好友请求");
        } catch (Exception e) {
            return ApiResponse.error(300, "处理好友请求失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse<Boolean> deleteFriend(Long userId, Long friendId) {
        try {
            // 删除双向好友关系
            QueryWrapper<Friendship> queryWrapper = new QueryWrapper<>();
            queryWrapper.and(wrapper -> wrapper
                    .or(w -> w.eq("user_id", userId).eq("friend_id", friendId))
                    .or(w -> w.eq("user_id", friendId).eq("friend_id", userId)));
            
            List<Friendship> friendships = friendshipMapper.selectFriendShipList(userId,friendId);
            for (Friendship friendship : friendships) {
                friendship.setStatus(STATUS_DELETED);
                friendship.setUpdatedAt(new Date());
                friendshipMapper.updateById(friendship);
            }

            return ApiResponse.success(true);
        } catch (Exception e) {
            return ApiResponse.error(300, "删除好友失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse<List<Map<String, Object>>> getPendingRequests(Long userId) {
        try {
            List<Map<String, Object>> pendingRequests = friendshipMapper.selectPendingRequestsWithDetails(userId);
            return ApiResponse.success(pendingRequests);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取待处理请求失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse<Integer> getFriendshipStatus(Long userId, Long friendId) {
        try {
            QueryWrapper<Friendship> queryWrapper = new QueryWrapper<>();
            queryWrapper.eq("user_id", userId)
                    .eq("friend_id", friendId);
            
            Friendship friendship = friendshipMapper.selectOne(queryWrapper);
            return ApiResponse.success( friendship != null ? friendship.getStatus() : -1);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取好友状态失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse<String> cancelFriendRequest(Long userId, Long friendId) {
        try {
            QueryWrapper<Friendship> queryWrapper = new QueryWrapper<>();
            queryWrapper.eq("user_id", userId)
                    .eq("friend_id", friendId)
                    .eq("status", STATUS_PENDING);
            
            friendshipMapper.delete(queryWrapper);
            return ApiResponse.success("取消好友请求成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "取消好友请求失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse<String> blockUser(Long userId, Long friendId) {
        try {
            QueryWrapper<Friendship> queryWrapper = new QueryWrapper<>();
            queryWrapper.eq("user_id", userId)
                    .eq("friend_id", friendId);
            
            Friendship friendship = friendshipMapper.selectOne(queryWrapper);
            if (friendship == null) {
                friendship = new Friendship();
                friendship.setUserId(userId);
                friendship.setFriendId(friendId);
                friendship.setCreatedAt(new Date());
            }
            
            friendship.setStatus(STATUS_BLOCKED);
            friendship.setUpdatedAt(new Date());
            
            saveOrUpdate(friendship);
            return ApiResponse.success("屏蔽用户成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "屏蔽用户失败：" + e.getMessage());
        }
    }
}




