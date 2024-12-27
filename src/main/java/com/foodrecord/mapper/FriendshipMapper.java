package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Friendship;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

@Mapper
public interface FriendshipMapper extends BaseMapper<Friendship> {

    @Select("SELECT u.id, u.username, u.avatar, f.status, f.created_at as friend_since " +
            "FROM friendship f " +
            "JOIN user u ON f.friend_id = u.id " +
            "WHERE f.user_id = #{userId} AND f.status = 1 " +
            "ORDER BY f.created_at DESC")
    List<Map<String, Object>> selectFriendListWithDetails(@Param("userId") Long userId);

    @Select("SELECT u.id, u.username, u.avatar " +
            "FROM friendship f1 " +
            "JOIN friendship f2 ON f1.friend_id = f2.friend_id " +
            "JOIN user u ON f1.friend_id = u.id " +
            "WHERE f1.user_id = #{userId1} AND f2.user_id = #{userId2} " +
            "AND f1.status = 1 AND f2.status = 1")
    List<Map<String, Object>> selectMutualFriends(@Param("userId1") Long userId1, @Param("userId2") Long userId2);

    @Select("SELECT u.id, u.username, u.avatar, COUNT(f2.friend_id) as mutual_friends " +
            "FROM friendship f1 " +
            "JOIN user u ON f1.friend_id = u.id " +
            "JOIN friendship f2 ON f1.friend_id = f2.user_id " +
            "WHERE f1.user_id IN (SELECT friend_id FROM friendship WHERE user_id = #{userId}) " +
            "AND f1.friend_id NOT IN (SELECT friend_id FROM friendship WHERE user_id = #{userId}) " +
            "AND f1.friend_id != #{userId} " +
            "GROUP BY u.id " +
            "ORDER BY mutual_friends DESC " +
            "LIMIT #{limit}")
    List<Map<String, Object>> selectRecommendedFriends(@Param("userId") Long userId, @Param("limit") Integer limit);

    @Select("SELECT u.id, u.username, u.avatar, f.message, f.created_at " +
            "FROM friendship f " +
            "JOIN user u ON f.user_id = u.id " +
            "WHERE f.friend_id = #{userId} AND f.status = 0 " +
            "ORDER BY f.created_at DESC")
    List<Map<String, Object>> selectPendingRequestsWithDetails(@Param("userId") Long userId);

    @Select("select count(*) from friendship where friend_id = #{userId} and `status` = 0")
    long selectPendingCount(Long userId, int statusPending);

    @Select("select count(*) from friendship where user_id = #{userId} and `status` = 1")
    long selectFriendCount(Long userId, int statusAccepted);

    @Select("select * from friendship where ( user_id = #{userId} and friend_id = #{friendId} ) and ( user_id = #{friendId} and friend_id = #{userId} )")
    List<Friendship> selectFriendShipList(Long userId, Long friendId);

    @Select("select * from friendship where user_id = #{userId} and friend_id = #{friendId} and `status` != 4")
    Friendship selectOneFriendship(Long userId, Long friendId);

    void save(Friendship friendship);
}