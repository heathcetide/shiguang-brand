package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.TopicsMapper;
import com.foodrecord.model.entity.Topics;
import com.foodrecord.service.TopicsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Service
public class TopicsServiceImpl extends ServiceImpl<TopicsMapper, Topics> implements TopicsService {

    @Autowired
    private TopicsMapper topicsMapper;

    @Override
    public Topics getTopicsByName(String name) {
        return topicsMapper.selectByName(name);
    }

    @Override
    public Topics getByTopicId(Long id) {
        return topicsMapper.selectTopicById(id);
    }

    @Override
    public List<Topics> getHotTopics() {
        return topicsMapper.selectHotTopics();
    }

    @Override
    public List<Topics> filterByPopularity(Integer minPopularity) {
        return topicsMapper.selectByPopularity(minPopularity);
    }

    @Override
    public boolean insert(Topics topics) {
        return topicsMapper.insert(topics) > 0;
    }

    @Override
    public List<Map<String, Object>> getTopicTrends(int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return topicsMapper.selectTopicTrends(startTime);
    }

    @Override
    public Map<String, Object> getTopicEngagement(Long topicId) {
        return topicsMapper.selectTopicEngagement(topicId);
    }

    @Override
    public List<Topics> getRelatedTopics(Long topicId, int limit) {
        return topicsMapper.selectRelatedTopics(topicId, limit);
    }

    @Override
    public List<Map<String, Object>> getUserTopicPreferences(Long userId) {
        return topicsMapper.selectUserTopicPreferences(userId);
    }

    @Override
    public Map<String, Object> getTopicActiveTimeAnalysis(Long topicId) {
        return topicsMapper.selectTopicActiveTimeAnalysis(topicId);
    }

    @Override
    public Map<String, Object> getTopicQualityScore(Long topicId) {
        return topicsMapper.selectTopicQualityScore(topicId);
    }

    @Override
    public Map<String, Object> getTopicInfluenceAnalysis(Long topicId) {
        return topicsMapper.selectTopicInfluenceAnalysis(topicId);
    }

    @Override
    public Map<String, Object> getTopicInteractionStats(Long topicId) {
        return topicsMapper.selectTopicInteractionStats(topicId);
    }

    @Override
    public List<Map<String, Object>> getTopicSpreadAnalysis(Long topicId) {
        return topicsMapper.selectTopicSpreadAnalysis(topicId);
    }

    @Override
    public Map<String, Object> getTopicSentimentAnalysis(Long topicId) {
        return topicsMapper.selectTopicSentimentAnalysis(topicId);
    }

    @Override
    public List<Map<String, Object>> getTopicKeywordAnalysis(Long topicId) {
        return topicsMapper.selectTopicKeywordAnalysis(topicId);
    }

    @Override
    public Map<String, Object> getTopicUserProfile(Long topicId) {
        return topicsMapper.selectTopicUserProfile(topicId);
    }

    @Override
    public Map<String, Object> getTopicRegionDistribution(Long topicId) {
        return topicsMapper.selectTopicRegionDistribution(topicId);
    }

    @Override
    public Map<String, Object> getTopicLifecycleAnalysis(Long topicId) {
        return topicsMapper.selectTopicLifecycleAnalysis(topicId);
    }

    @Override
    @Transactional
    public void batchUpdatePopularity(List<Long> topicIds) {
        topicsMapper.batchUpdatePopularity(topicIds);
    }

    @Override
    @Transactional
    public boolean mergeTopics(Long sourceTopicId, Long targetTopicId) {
        try {
            // 1. 获取源话题和目标话题
            Topics sourceTopic = topicsMapper.selectTopicById(sourceTopicId);
            Topics targetTopic = topicsMapper.selectTopicById(targetTopicId);
            
            if (sourceTopic == null || targetTopic == null) {
                return false;
            }

            // 2. 更新所有相关帖子的话题ID
            this.update()
                .setSql("topic_id = " + targetTopicId)
                .eq("topic_id", sourceTopicId)
                .update();

            // 3. 合并热度值
            targetTopic.setPopularity(targetTopic.getPopularity() + sourceTopic.getPopularity());
            this.updateById(targetTopic);

            // 4. 删除源话题
            this.removeById(sourceTopicId);

            return true;
        } catch (Exception e) {
            log.error("合并话题失败", e);
            return false;
        }
    }

    @Override
    public List<Map<String, Object>> getTopicCategoryStats() {
        return topicsMapper.selectTopicCategoryStats();
    }

    @Override
    public Map<String, Object> getTopicQualityDistribution() {
        return topicsMapper.selectTopicQualityDistribution();
    }

    @Override
    public List<Map<String, Object>> getTopicGrowthTrend(Long topicId, int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return topicsMapper.selectTopicGrowthTrend(topicId, startTime);
    }

    @Override
    public List<Map<String, Object>> getTopicUserRanking(Long topicId, int limit) {
        return topicsMapper.selectTopicUserRanking(topicId, limit);
    }

    @Override
    public List<Map<String, Object>> getTopicPeakTimes(Long topicId, int days) {
        LocalDateTime startTime = LocalDateTime.now().minusDays(days);
        return topicsMapper.selectTopicPeakTimes(topicId, startTime);
    }

    @Override
    public Map<String, Object> getTopicContentTypeDistribution(Long topicId) {
        return topicsMapper.selectTopicContentTypeDistribution(topicId);
    }

    @Override
    public List<Map<String, Object>> getTopicReferenceAnalysis(Long topicId) {
        return topicsMapper.selectTopicReferenceAnalysis(topicId);
    }

    @Override
    public List<Map<String, Object>> getTopicCompetitionAnalysis(Long topicId) {
        return topicsMapper.selectTopicCompetitionAnalysis(topicId);
    }
}
