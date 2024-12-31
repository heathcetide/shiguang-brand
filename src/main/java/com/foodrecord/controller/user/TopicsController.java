package com.foodrecord.controller.user;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.Topics;
import com.foodrecord.service.IpBlockService;
import com.foodrecord.service.TopicsService;
import com.google.common.util.concurrent.RateLimiter;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/topic")
@Api(tags = "热点话题管理")
public class TopicsController {
    @Autowired
    private TopicsService topicsService;

    @Autowired
    private IpBlockService ipBlockService;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    public static String TOPICS_ALL = "topics/all";
    public static String TOPIC_BY_ID = "topics/by-id";

    RateLimiter topicsRateLimiter = RateLimiter.create(500.0);

    private final ObjectMapper objectMapper = new ObjectMapper();

    @ApiOperation("获取所有话题")
    @GetMapping("/list")
    public ApiResponse<List<Topics>> getAllTopics(HttpServletRequest request) {
        String clientIp = ipBlockService.getClientIp(request);
        if (ipBlockService.isBlocked(clientIp)) {
            throw new RuntimeException("ip已经被封禁，请稍后再访问");
        }
        try {
            if (!topicsRateLimiter.tryAcquire()) {
                throw new RuntimeException("流量访问过快，请稍后再试");
            }
        } catch (Exception e) {
            if (e.getMessage().contains("流量访问过快")) {
                ipBlockService.recordAbnormalAccess(clientIp);
            }
            throw e;
        }
        List<Topics> topicsList;
        try {
            String allTopics = stringRedisTemplate.opsForValue().get(TOPICS_ALL);
            if (allTopics == null) {
                topicsList = topicsService.list();
                if (topicsList.isEmpty()) {
                    stringRedisTemplate.opsForValue().set(TOPICS_ALL, "[]", 1, TimeUnit.MINUTES);
                } else {
                    stringRedisTemplate.opsForValue().set(TOPICS_ALL, objectMapper.writeValueAsString(topicsList), 10, TimeUnit.MINUTES);
                }
            } else {
                topicsList = objectMapper.readValue(allTopics, new TypeReference<List<Topics>>() {
                });
            }
            return ApiResponse.success(topicsList);
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    @ApiOperation("根据ID获取话题")
    @GetMapping("/{id}")
    public ApiResponse<Topics> getTopicById(@PathVariable Long id, HttpServletRequest request) {
        String clientIp = ipBlockService.getClientIp(request);
        if (ipBlockService.isBlocked(clientIp)) {
            throw new RuntimeException("该ip已被封禁，请稍后再试");
        }
        try {
            if (id < 0L) {
                throw new RuntimeException("参数不合法，请重试");
            }
            if (topicsRateLimiter.tryAcquire()) {
                throw new RuntimeException("该接口已被限流，请稍后再试");
            }
        } catch (Exception e) {
            if (e.getMessage().contains("参数不合法") || e.getMessage().contains("限流")) {
                ipBlockService.recordAbnormalAccess(clientIp);
            }
            throw e;
        }

        try {
            Topics topics = objectMapper.readValue(stringRedisTemplate.opsForValue().get(TOPIC_BY_ID + id), Topics.class);
            if (topics == null) {
                topics = topicsService.getByTopicId(id);
                if (topics == null) {
                    stringRedisTemplate.opsForValue().set(TOPIC_BY_ID + id, objectMapper.writeValueAsString(topics), 30, TimeUnit.SECONDS);
                }
                {
                    stringRedisTemplate.opsForValue().set(TOPIC_BY_ID + id, objectMapper.writeValueAsString(topics), 3, TimeUnit.MINUTES);
                }
            }
            if (topics != null) {
                return ApiResponse.success(topics);
            } else {
                return ApiResponse.error(300,"话题不存在");
            }
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    @ApiOperation("新增话题")
    @PostMapping("/add")
    public ApiResponse<String> addTopic(@RequestBody @Valid Topics topic) {
        Topics byId = topicsService.getTopicsByName(topic.getName());
        if (byId == null) {
            boolean isSaved = topicsService.insert(topic);
            if (isSaved) {
                stringRedisTemplate.delete(TOPIC_BY_ID + topic.getId());
                stringRedisTemplate.delete(TOPICS_ALL);

                Executors.newSingleThreadScheduledExecutor().schedule(() -> {
                    stringRedisTemplate.delete(TOPIC_BY_ID + topic.getId());
                    stringRedisTemplate.delete(TOPICS_ALL);
                }, 500, TimeUnit.MILLISECONDS);

                CompletableFuture.runAsync(this::rebuildTopicsCache);

                return ApiResponse.success("新增话题成功");
            } else {
                return ApiResponse.error(300,"新增话题成功");
            }
        } else {
            return ApiResponse.error(300,"该话题已存在");
        }
    }

    @ApiOperation("更新话题")
    @PutMapping("/update")
    public ApiResponse<String> updateTopic(@RequestBody Topics topic) {
        boolean isUpdated = topicsService.updateById(topic);
        if (isUpdated) {
            return ApiResponse.success("更新话题成功");
        } else {
            return ApiResponse.error(300,"更新话题失败");
        }
    }

    @ApiOperation("根据ID删除话题")
    @DeleteMapping("/delete/{id}")
    public ApiResponse<String> deleteTopic(@PathVariable Long id) {
        boolean isDeleted = topicsService.removeById(id);
        if (isDeleted) {
            return ApiResponse.success("删除话题成功");
        } else {
            return ApiResponse.error(300,"删除话题失败");
        }
    }

    @ApiOperation("根据名称查询话题")
    @GetMapping("/search")
    public ApiResponse<Topics> searchTopicsByName(@RequestParam String name) {
        Topics topics = topicsService.getTopicsByName(name);
        return ApiResponse.success(topics);
    }

    @ApiOperation("热门话题列表（按热度排序）")
    @GetMapping("/hot")
    public ApiResponse<List<Topics>> getHotTopics() {
        List<Topics> hotTopics = topicsService.getHotTopics();
        if (hotTopics != null){
            return ApiResponse.success(hotTopics);
        }
        return ApiResponse.error(300, "没有帖子存在");
    }

    @ApiOperation("批量删除话题")
    @DeleteMapping("/delete/batch")
    public ApiResponse<String> deleteBatch(@RequestBody List<Long> ids) {
        boolean isDeleted = topicsService.removeByIds(ids);
        if (isDeleted) {
            return ApiResponse.success("批量删除成功");
        } else {
            return ApiResponse.success("批量删除失败");
        }
    }

    @ApiOperation("从Redis缓存中获取话题")
    @GetMapping("/cache/{id}")
    public ApiResponse<Topics> getTopicFromCache(@PathVariable Long id) throws JsonProcessingException {
        String cacheKey = "topic:" + id;
        String topicJson = stringRedisTemplate.opsForValue().get(cacheKey);
        if (topicJson != null) {
            Topics topic = objectMapper.readValue(topicJson, new TypeReference<>() {
            });
            return ApiResponse.success(topic);
        } else {
            Topics topic = topicsService.getByTopicId(id);
            if (topic != null) {
                stringRedisTemplate.opsForValue().set(cacheKey, objectMapper.writeValueAsString(topic), 10, TimeUnit.MINUTES);
                return ApiResponse.success(topic);
            } else {
                return ApiResponse.error(300,"该帖子不存在");
            }
        }
    }

    @ApiOperation("根据热度值过滤话题")
    @GetMapping("/filterByPopularity")
    public ApiResponse<List<Topics>> filterByPopularity(@RequestParam Integer minPopularity) {
        List<Topics> filteredTopics = topicsService.filterByPopularity(minPopularity);
        return ApiResponse.success(filteredTopics);
    }

    @ApiOperation("获取话题趋势分析")
    @GetMapping("/trends")
    public ApiResponse<List<Map<String, Object>>> getTopicTrends(@RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(topicsService.getTopicTrends(days));
    }

    @ApiOperation("获取话题参与度分析")
    @GetMapping("/{topicId}/engagement")
    public ApiResponse<Map<String, Object>> getTopicEngagement(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicEngagement(topicId));
    }

    @ApiOperation("获取相关话题推荐")
    @GetMapping("/{topicId}/related")
    public ApiResponse<List<Topics>> getRelatedTopics(
            @PathVariable Long topicId,
            @RequestParam(defaultValue = "5") int limit) {
        return ApiResponse.success(topicsService.getRelatedTopics(topicId, limit));
    }

    @ApiOperation("获取用户话题偏好")
    @GetMapping("/user/{userId}/preferences")
    public ApiResponse<List<Map<String, Object>>> getUserTopicPreferences(@PathVariable Long userId) {
        return ApiResponse.success(topicsService.getUserTopicPreferences(userId));
    }

    @ApiOperation("获取话题活跃时段分析")
    @GetMapping("/{topicId}/active-time")
    public ApiResponse<Map<String, Object>> getTopicActiveTimeAnalysis(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicActiveTimeAnalysis(topicId));
    }

    @ApiOperation("获取话题质量评分")
    @GetMapping("/{topicId}/quality-score")
    public ApiResponse<Map<String, Object>> getTopicQualityScore(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicQualityScore(topicId));
    }

    @ApiOperation("获取话题影响力分析")
    @GetMapping("/{topicId}/influence")
    public ApiResponse<Map<String, Object>> getTopicInfluenceAnalysis(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicInfluenceAnalysis(topicId));
    }

    @ApiOperation("获取话题互动统计")
    @GetMapping("/{topicId}/interaction-stats")
    public ApiResponse<Map<String, Object>> getTopicInteractionStats(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicInteractionStats(topicId));
    }

    @ApiOperation("获取话题传播路径分析")
    @GetMapping("/{topicId}/spread-analysis")
    public ApiResponse<List<Map<String, Object>>> getTopicSpreadAnalysis(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicSpreadAnalysis(topicId));
    }

    @ApiOperation("获取话题情感分析")
    @GetMapping("/{topicId}/sentiment")
    public ApiResponse<Map<String, Object>> getTopicSentimentAnalysis(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicSentimentAnalysis(topicId));
    }

    @ApiOperation("获取话题关键词分析")
    @GetMapping("/{topicId}/keywords")
    public ApiResponse<List<Map<String, Object>>> getTopicKeywordAnalysis(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicKeywordAnalysis(topicId));
    }

    @ApiOperation("获取话题用户画像")
    @GetMapping("/{topicId}/user-profile")
    public ApiResponse<Map<String, Object>> getTopicUserProfile(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicUserProfile(topicId));
    }

    @ApiOperation("获取话题地域分布")
    @GetMapping("/{topicId}/region-distribution")
    public ApiResponse<Map<String, Object>> getTopicRegionDistribution(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicRegionDistribution(topicId));
    }

    @ApiOperation("获取话题生命周期分析")
    @GetMapping("/{topicId}/lifecycle")
    public ApiResponse<Map<String, Object>> getTopicLifecycleAnalysis(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicLifecycleAnalysis(topicId));
    }

    @ApiOperation("批量更新话题热度")
    @PostMapping("/batch-update-popularity")
    public ApiResponse<Void> batchUpdatePopularity(@RequestBody List<Long> topicIds) {
        topicsService.batchUpdatePopularity(topicIds);
        return ApiResponse.success(null);
    }

    @ApiOperation("合并相似话题")
    @PostMapping("/merge")
    public ApiResponse<Boolean> mergeTopics(
            @RequestParam Long sourceTopicId,
            @RequestParam Long targetTopicId) {
        return ApiResponse.success(topicsService.mergeTopics(sourceTopicId, targetTopicId));
    }

    @ApiOperation("获取话题分类统计")
    @GetMapping("/category-stats")
    public ApiResponse<List<Map<String, Object>>> getTopicCategoryStats() {
        return ApiResponse.success(topicsService.getTopicCategoryStats());
    }

    @ApiOperation("获取话题质量分布")
    @GetMapping("/quality-distribution")
    public ApiResponse<Map<String, Object>> getTopicQualityDistribution() {
        return ApiResponse.success(topicsService.getTopicQualityDistribution());
    }

    @ApiOperation("获取话题成长趋势")
    @GetMapping("/{topicId}/growth-trend")
    public ApiResponse<List<Map<String, Object>>> getTopicGrowthTrend(
            @PathVariable Long topicId,
            @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.success(topicsService.getTopicGrowthTrend(topicId, days));
    }

    @ApiOperation("获取话题参与用户排行")
    @GetMapping("/{topicId}/user-ranking")
    public ApiResponse<List<Map<String, Object>>> getTopicUserRanking(
            @PathVariable Long topicId,
            @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(topicsService.getTopicUserRanking(topicId, limit));
    }

    @ApiOperation("获取话题互动高峰期")
    @GetMapping("/{topicId}/peak-times")
    public ApiResponse<List<Map<String, Object>>> getTopicPeakTimes(
            @PathVariable Long topicId,
            @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(topicsService.getTopicPeakTimes(topicId, days));
    }

    @ApiOperation("获取话题内容类型分布")
    @GetMapping("/{topicId}/content-type-distribution")
    public ApiResponse<Map<String, Object>> getTopicContentTypeDistribution(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicContentTypeDistribution(topicId));
    }

    @ApiOperation("获取话题引用分析")
    @GetMapping("/{topicId}/reference-analysis")
    public ApiResponse<List<Map<String, Object>>> getTopicReferenceAnalysis(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicReferenceAnalysis(topicId));
    }

    @ApiOperation("获取话题竞品分析")
    @GetMapping("/{topicId}/competition-analysis")
    public ApiResponse<List<Map<String, Object>>> getTopicCompetitionAnalysis(@PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicCompetitionAnalysis(topicId));
    }

    @Async
    public void rebuildTopicsCache() {
        List<Topics> topicsList = topicsService.list();
        try {
            stringRedisTemplate.opsForValue().set(TOPICS_ALL, objectMapper.writeValueAsString(topicsList), 10, TimeUnit.MINUTES);
        } catch (JsonProcessingException e) {
            e.printStackTrace();
        }
    }
}
