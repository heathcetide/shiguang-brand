package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.Topics;

import java.util.List;
import java.util.Map;

/**
* @author Lenovo
* @description 针对表【topics】的数据库操作Service
* @createDate 2024-12-02 21:47:52
*/
public interface TopicsService extends IService<Topics> {
    /**
     * 根据名称获取话题
     */
    Topics getTopicsByName(String name);

    /**
     * 根据ID获取话题
     */
    Topics getByTopicId(Long id);

    /**
     * 获取热门话题列表
     */
    List<Topics> getHotTopics();

    /**
     * 根据热度值过滤话题
     */
    List<Topics> filterByPopularity(Integer minPopularity);

    /**
     * 新增话题
     */
    boolean insert(Topics topics);

    /**
     * 获取话题趋势分析
     */
    List<Map<String, Object>> getTopicTrends(int days);

    /**
     * 获取话题参与度分析
     */
    Map<String, Object> getTopicEngagement(Long topicId);

    /**
     * 获取相关话题推荐
     */
    List<Topics> getRelatedTopics(Long topicId, int limit);

    /**
     * 获取用户话题偏好
     */
    List<Map<String, Object>> getUserTopicPreferences(Long userId);

    /**
     * 获取话题活跃时段分析
     */
    Map<String, Object> getTopicActiveTimeAnalysis(Long topicId);

    /**
     * 获取话题质量评分
     */
    Map<String, Object> getTopicQualityScore(Long topicId);

    /**
     * 获取话题影响力分析
     */
    Map<String, Object> getTopicInfluenceAnalysis(Long topicId);

    /**
     * 获取话题互动统计
     */
    Map<String, Object> getTopicInteractionStats(Long topicId);

    /**
     * 获取话题传播路径分析
     */
    List<Map<String, Object>> getTopicSpreadAnalysis(Long topicId);

    /**
     * 获取话题情感分析
     */
    Map<String, Object> getTopicSentimentAnalysis(Long topicId);

    /**
     * 获取话题关键词分析
     */
    List<Map<String, Object>> getTopicKeywordAnalysis(Long topicId);

    /**
     * 获取话题用户画像
     */
    Map<String, Object> getTopicUserProfile(Long topicId);

    /**
     * 获取话题地域分布
     */
    Map<String, Object> getTopicRegionDistribution(Long topicId);

    /**
     * 获取话题生命周期分析
     */
    Map<String, Object> getTopicLifecycleAnalysis(Long topicId);

    /**
     * 批量更新话题热度
     */
    void batchUpdatePopularity(List<Long> topicIds);

    /**
     * 合并相似话题
     */
    boolean mergeTopics(Long sourceTopicId, Long targetTopicId);

    /**
     * 获取话题分类统计
     */
    List<Map<String, Object>> getTopicCategoryStats();

    /**
     * 获取话题质量分布
     */
    Map<String, Object> getTopicQualityDistribution();

    /**
     * 获取话题成长趋势
     */
    List<Map<String, Object>> getTopicGrowthTrend(Long topicId, int days);

    /**
     * 获取话题参与用户排行
     */
    List<Map<String, Object>> getTopicUserRanking(Long topicId, int limit);

    /**
     * 获取话题互动高峰期
     */
    List<Map<String, Object>> getTopicPeakTimes(Long topicId, int days);

    /**
     * 获取话题内容类型分布
     */
    Map<String, Object> getTopicContentTypeDistribution(Long topicId);

    /**
     * 获取话题引用分析
     */
    List<Map<String, Object>> getTopicReferenceAnalysis(Long topicId);

    /**
     * 获取话题竞品分析
     */
    List<Map<String, Object>> getTopicCompetitionAnalysis(Long topicId);
}
