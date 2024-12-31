package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.PostLikes;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Param;

/**
* @author Lenovo
* @description 针对表【post_likes】的数据库操作Mapper
* @createDate 2024-12-02 21:47:52
* @Entity com.cetide.cecomment.model.entity.PostLikes
*/
@Mapper
public interface PostLikesMapper extends BaseMapper<PostLikes> {

    @Select("select * from post_likes where post_id = #{postId} and user_id = #{userId}")
    PostLikes finPostByPostIdAndUserId(Long postId, Long userId);

    @Insert("insert into post_likes(post_id, user_id) values(#{postId},#{userId})")
    Boolean save(PostLikes like);

    @Delete("delete from post_likes where user_id = #{userId} and post_id = #{postId}")
    int deleteByWrapper(Long userId, Long postId);

    @Select("        SELECT EXISTS(\n" +
            "            SELECT 1 FROM post_likes \n" +
            "            WHERE post_id = #{postId} \n" +
            "            AND user_id = #{userId}\n" +
            "        )")
    boolean existsPost(Long postId, Long userId);

    @Delete("DELETE FROM post_likes \n" +
            "        WHERE post_id = #{postId} \n" +
            "        AND user_id = #{userId}")
    int deletePost(Long postId, Long userId);

    /**
     * 根据帖子ID删除点赞记录
     */
    int deleteByPostId(@Param("postId") Long postId);

    /**
     * 检查点赞是否存在
     */
//    boolean existsPost(@Param("postId") Long postId, @Param("userId") Long userId);

    /**
     * 删除点赞记录
     */
//    int deletePost(@Param("postId") Long postId, @Param("userId") Long userId);
}




