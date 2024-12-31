package com.foodrecord.service;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.video.Videos;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * 视频服务接口，定义了视频相关的操作方法
 */
public interface VideosService {

    /**
     * 上传视频
     *
     * @param file        视频文件
     * @param title       视频标题
     * @param description 视频描述
     * @param userId      用户ID
     * @param tags        视频标签列表
     * @return 返回上传视频的结果
     */
    ApiResponse uploadVideo(MultipartFile file, String title, String description, Long userId, List<String> tags);

    /**
     * 获取视频详情
     *
     * @param id 视频ID
     * @return 包含视频详情的响应
     */
    ApiResponse<Map<String, Object>> getVideoDetails(Long id);

    /**
     * 获取推荐视频列表
     *
     * @param userId   用户ID
     * @param pageNum  页码
     * @param pageSize 每页数量
     * @return 包含推荐视频列表的响应
     */
    ApiResponse getRecommendedVideos(Long userId, Integer pageNum, Integer pageSize);

    /**
     * 根据关键字搜索视频
     *
     * @param keyword  搜索关键字
     * @param pageNum  页码
     * @param pageSize 每页数量
     * @return 包含搜索结果的响应
     */
    ApiResponse searchVideos(String keyword, Integer pageNum, Integer pageSize);

    /**
     * 根据标签获取视频
     *
     * @param tag      视频标签
     * @param pageNum  页码
     * @param pageSize 每页数量
     * @return 包含对应标签视频列表的响应
     */
    ApiResponse getVideosByTag(String tag, Integer pageNum, Integer pageSize);

    /**
     * 获取用户上传的视频
     *
     * @param userId   用户ID
     * @param pageNum  页码
     * @param pageSize 每页数量
     * @return 包含用户视频列表的响应
     */
    ApiResponse getUserVideos(Long userId, Integer pageNum, Integer pageSize);

    /**
     * 删除视频
     *
     * @param id     视频ID
     * @param userId 用户ID
     * @return 删除操作的结果
     */
    ApiResponse deleteVideo(Long id, Long userId);

    /**
     * 更新视频信息
     *
     * @param video 视频实体对象，包含需要更新的信息
     * @return 更新操作的结果
     */
    ApiResponse updateVideo(Videos video);

    /**
     * 获取下一条视频（例如：自动播放下一视频）
     *
     * @param lastVideoId 上一条视频的ID
     * @return 下一条视频的详情
     */
    ApiResponse getNextVideo(Long lastVideoId);

    /**
     * 获取热门视频
     */
    ApiResponse getTrendingVideos(Integer pageNum, Integer pageSize, String timeRange);

    /**
     * 获取分类热门视频
     */
    ApiResponse getTrendingByCategory(String category, Integer pageNum, Integer pageSize);

    /**
     * 定时发布视频
     */
    ApiResponse scheduleVideo(Long videoId, String publishTime, Long userId);

    /**
     * 获取定时发布列表
     */
    ApiResponse getScheduledVideos(Long userId, Integer pageNum, Integer pageSize);

    /**
     * 取消定时发布
     */
    ApiResponse cancelScheduledVideo(Long videoId, Long userId);
}
