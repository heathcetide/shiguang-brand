package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.PostFavorites;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface PostFavoritesMapper extends BaseMapper<PostFavorites> {
    
    @Select("SELECT COUNT(*) > 0 FROM post_favorites WHERE post_id = #{postId} AND user_id = #{userId} AND is_delete = 0")
    boolean exists(@Param("postId") Long postId, @Param("userId") Long userId);
    
    @Delete("UPDATE post_favorites SET is_delete = 1 WHERE post_id = #{postId} AND user_id = #{userId}")
    int deleteFavouriteRecord(@Param("postId") Long postId, @Param("userId") Long userId);

    /**
     * 根据帖子ID删除收藏记录
     */
    int deleteByPostId(@Param("postId") Long postId);
} 