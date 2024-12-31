package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.video.VideoComments;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;

@Mapper
public interface VideoCommentsMapper extends BaseMapper<VideoComments> {
    
    /**
     * 查询视频评论列表
     */
    List<Map<String, Object>> selectVideoComments(@Param("videoId") Long videoId,
                                                 @Param("offset") int offset,
                                                 @Param("pageSize") int pageSize);
    
    /**
     * 删除评论
     */
    int deleteComment(@Param("id") Long id, @Param("userId") Long userId);
    
    /**
     * 更新评论
     */
    int updateComment(VideoComments comment);
    
    /**
     * 增加评论回复数
     */
    int incrementReplyCount(@Param("commentId") Long commentId);
    
    /**
     * 查询评论的回复列表
     */
    List<Map<String, Object>> selectReplies(@Param("commentId") Long commentId,
                                           @Param("offset") int offset,
                                           @Param("pageSize") int pageSize);
    
    /**
     * 统计评论的回复数量
     */
    int countReplies(@Param("commentId") Long commentId);
}




