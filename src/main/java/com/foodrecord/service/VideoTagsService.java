package com.foodrecord.service;


import com.foodrecord.common.ApiResponse;

import java.util.List;

/**
 * 视频标签服务接口，提供与视频标签相关的操作
 */
public interface VideoTagsService {

    /**
     * 为指定的视频添加标签
     *
     * @param videoId 视频ID
     * @param tags    标签列表
     * @return 操作结果的响应
     */
    ApiResponse addTags(Long videoId, List<String> tags);

    /**
     * 从指定的视频中移除标签
     *
     * @param videoId 视频ID
     * @param tags    要移除的标签列表
     * @return 操作结果的响应
     */
    ApiResponse removeTags(Long videoId, List<String> tags);

    /**
     * 获取指定视频的所有标签
     *
     * @param videoId 视频ID
     * @return 包含标签列表的响应
     */
    ApiResponse getVideoTags(Long videoId);

    /**
     * 根据标签获取视频列表
     *
     * @param tag      视频标签
     * @param pageNum  页码
     * @param pageSize 每页数量
     * @return 包含对应标签视频列表的响应
     */
    ApiResponse getVideosByTag(String tag, Integer pageNum, Integer pageSize);

    /**
     * 获取系统中最受欢迎的标签
     *
     * @param limit 限制返回的标签数量
     * @return 包含热门标签的响应
     */
    ApiResponse getPopularTags(Integer limit);
}
