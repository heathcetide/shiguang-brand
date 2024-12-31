package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.Post;
import com.foodrecord.model.vo.PostSearchVO;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

public interface PostSearchService {
    
    /**
     * 基础搜索帖子
     */
    Page<Post> search(String keyword, Page<Post> page);

    /**
     * 高级搜索帖子
     * @param searchVO 搜索条件
     * @param page 分页参数
     * @return 搜索结果
     */
    Page<Post> advancedSearch(PostSearchVO searchVO, Page<Post> page);

    /**
     * 根据时间范围搜索帖子
     */
    Page<Post> searchByTimeRange(LocalDateTime startTime, LocalDateTime endTime, Page<Post> page);

    /**
     * 获取相似帖子推荐
     * @param postId 帖子ID
     * @param limit 限制数量
     * @return 相似帖子列表
     */
    List<Post> getSimilarPosts(Long postId, int limit);

    /**
     * 获取热门搜索词
     * @param limit 限制数量
     * @return 搜索词和搜索次数
     */
    List<Map<String, Object>> getHotSearchWords(int limit);

    /**
     * 记录用户搜索历史
     * @param userId 用户ID
     * @param keyword 搜索关键词
     */
    void saveSearchHistory(Long userId, String keyword);

    /**
     * 获取用户搜索历史
     * @param userId 用户ID
     * @param limit 限制数量
     * @return 搜索历史列表
     */
    List<String> getUserSearchHistory(Long userId, int limit);

    /**
     * 根据标签聚合统计
     */
    Map<String, Long> aggregateByTags();

    /**
     * 获取搜索建议
     */
    List<String> suggest(String prefix);

    /**
     * 同步单个帖子到ES
     */
    void syncToES(Post post);

    /**
     * 批量同步帖子到ES
     */
    void syncBatchToES(List<Post> posts);

    /**
     * 从ES中删除帖子
     */
    void deleteFromES(Long postId);

    /**
     * 获取热门话题
     * 基于标签和内容分析，返回当前热门讨论的话题
     * @param days 最近几天
     * @param limit 返回数量
     */
    List<Map<String, Object>> getHotTopics(int days, int limit);

    /**
     * 获取相关帖子推荐
     * 基于用户的浏览历史和兴趣标签
     * @param userId 用户ID
     * @param limit 返回数量
     */
    List<Post> getPersonalizedRecommendations(Long userId, int limit);

    /**
     * 获取热门地点
     * 分析帖子中提到的地点，返回热门地点及其提及次数
     * @param limit 返回数量
     */
    List<Map<String, Object>> getHotLocations(int limit);

    /**
     * 情感分析
     * 分析帖子的情感倾向（积极、消极、中性）
     * @param postId 帖子ID
     */
    Map<String, Object> analyzeSentiment(Long postId);

    /**
     * 获取趋势分析
     * 分析标签和话题随时间的变化趋势
     * @param days 最近几天
     */
    List<Map<String, Object>> getTrends(int days);

    /**
     * 相似用户推荐
     * 基于用户的发帖内容和标签，推荐相似的用户
     * @param userId 用户ID
     * @param limit 返回数量
     */
    List<Map<String, Object>> getSimilarUsers(Long userId, int limit);

    /**
     * 获取热门时段
     * 分析用户发帖的时间分布
     * @param days 最近几天
     */
    Map<String, Long> getHotTimeDistribution(int days);

    /**
     * 获取标签关联分析
     * 分析标签之间的关联关系
     * @param tagName 标签名
     * @param limit 返回数量
     */
    List<Map<String, Object>> getTagRelations(String tagName, int limit);

    /**
     * 获取内容质量评分
     * 基于多个维度对帖子进行质量评分
     * @param postId 帖子ID
     */
    Map<String, Object> getContentQualityScore(Long postId);

    /**
     * 获取内容质量列表
     */
    List<Map<String, Object>> getContentQualityList(int limit);

    /**
     * 获取敏感词列表
     */
    List<Map<String, Object>> getSensitiveWordsList(int limit);

    /**
     * 获取用户行为分析
     */
    Map<String, Object> getUserBehaviorAnalysis(Long userId, int days);

    /**
     * 获取内容趋势分析
     */
    List<Map<String, Object>> getContentTrendsAnalysis(int days);

    /**
     * 重建索引
     */
    void rebuildIndex();

    /**
     * 获取关键词分析
     */
    List<Map<String, Object>> getKeywordAnalysis(int days, int limit);

    /**
     * 获取内容质量分布
     */
    Map<String, Object> getQualityDistribution();
} 