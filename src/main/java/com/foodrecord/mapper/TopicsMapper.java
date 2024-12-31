package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Topics;
import org.apache.ibatis.annotations.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
* @author Lenovo
* @description 针对表【topics】的数据库操作Mapper
* @createDate 2024-12-02 21:47:52
* @Entity com.cetide.cecomment.model.entity.Topics
*/
@Mapper
public interface TopicsMapper extends BaseMapper<Topics> {

    @Select("SELECT * FROM topics WHERE name = #{name} AND is_delete = 0")
    Topics selectByName(String name);

    @Select("SELECT * FROM topics WHERE id = #{id} AND is_delete = 0")
    Topics selectTopicById(Long id);

    @Select("SELECT * FROM topics WHERE is_delete = 0 ORDER BY popularity DESC LIMIT 10")
    List<Topics> selectHotTopics();

    @Select("SELECT * FROM topics WHERE popularity >= #{minPopularity} AND is_delete = 0")
    List<Topics> selectByPopularity(Integer minPopularity);

    @Insert("INSERT INTO topics (name, popularity, created_at) VALUES (#{name}, #{popularity}, #{createdAt})")
    int insert(Topics topics);

    /**
     * 获取话题趋势分析
     */
    List<Map<String, Object>> selectTopicTrends(@Param("startTime") LocalDateTime startTime);

    /**
     * 获取话题参与度分析
     */
    Map<String, Object> selectTopicEngagement(@Param("topicId") Long topicId);

    /**
     * 获取相关话题
     */
    List<Topics> selectRelatedTopics(@Param("topicId") Long topicId, @Param("limit") int limit);

    /**
     * 获取用户话题偏好
     */
    List<Map<String, Object>> selectUserTopicPreferences(@Param("userId") Long userId);

    /**
     * 获取话题活跃时段分析
     */
    Map<String, Object> selectTopicActiveTimeAnalysis(@Param("topicId") Long topicId);

    /**
     * 获取话题质量评分
     */
    Map<String, Object> selectTopicQualityScore(@Param("topicId") Long topicId);

    /**
     * 获取话题影响力分析
     */
    Map<String, Object> selectTopicInfluenceAnalysis(@Param("topicId") Long topicId);

    /**
     * 获取话题互动统计
     */
    Map<String, Object> selectTopicInteractionStats(@Param("topicId") Long topicId);

    /**
     * 获取话题传播路径分析
     */
    List<Map<String, Object>> selectTopicSpreadAnalysis(@Param("topicId") Long topicId);

    /**
     * 获取话题情感分析
     */
    Map<String, Object> selectTopicSentimentAnalysis(@Param("topicId") Long topicId);

    /**
     * 获取话题关键词分析
     */
    List<Map<String, Object>> selectTopicKeywordAnalysis(@Param("topicId") Long topicId);

    /**
     * 获取话题用户画像
     */
    Map<String, Object> selectTopicUserProfile(@Param("topicId") Long topicId);

    /**
     * 获取话题地域分布
     */
    Map<String, Object> selectTopicRegionDistribution(@Param("topicId") Long topicId);

    /**
     * 获取话题生命周期分析
     */
    Map<String, Object> selectTopicLifecycleAnalysis(@Param("topicId") Long topicId);

    /**
     * 批量更新话题热度
     */
    void batchUpdatePopularity(@Param("topicIds") List<Long> topicIds);

    /**
     * 获取话题分类统计
     */
    List<Map<String, Object>> selectTopicCategoryStats();

    /**
     * 获取话题质量分布
     */
    Map<String, Object> selectTopicQualityDistribution();

    /**
     * 获取话题成长趋势
     */
    List<Map<String, Object>> selectTopicGrowthTrend(@Param("topicId") Long topicId, @Param("startTime") LocalDateTime startTime);

    /**
     * 获取话题参与用户排行
     */
    List<Map<String, Object>> selectTopicUserRanking(@Param("topicId") Long topicId, @Param("limit") int limit);

    /**
     * 获取话题互动高峰期
     */
    List<Map<String, Object>> selectTopicPeakTimes(@Param("topicId") Long topicId, @Param("startTime") LocalDateTime startTime);

    /**
     * 获取话题内容类型分布
     */
    Map<String, Object> selectTopicContentTypeDistribution(@Param("topicId") Long topicId);

    /**
     * 获取话题引用分析
     */
    List<Map<String, Object>> selectTopicReferenceAnalysis(@Param("topicId") Long topicId);

    /**
     * 获取话题竞品分析
     */
    List<Map<String, Object>> selectTopicCompetitionAnalysis(@Param("topicId") Long topicId);
}




