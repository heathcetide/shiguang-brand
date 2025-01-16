package com.foodrecord.controller.user;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.security.desensitize.DesensitizeRuleConfig;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.model.entity.Topics;
import com.foodrecord.service.IpBlockService;
import com.foodrecord.service.TopicsService;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.google.common.util.concurrent.RateLimiter;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
//import org.apache.kafka.streams.processor.To;
import io.swagger.annotations.ApiParam;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.web.bind.annotation.*;

import javax.annotation.PostConstruct;
import javax.servlet.http.HttpServletRequest;
import javax.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
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

    @Autowired
    private RedisUtils redisUtils;

    public static String TOPICS_ALL = "topics/all";
    public static String TOPIC_BY_ID = "topics/by-id";
    public static String FALL_BACK_TOPICS_ALL = "fall/topics/all";
    RateLimiter topicsRateLimiter = RateLimiter.create(1000.0);
    private final Logger logger = LoggerFactory.getLogger(TopicsController.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final Cache<String, List<Topics>> topicsCache = Caffeine.newBuilder()
            .expireAfterWrite(10, TimeUnit.SECONDS)
            .maximumSize(100) // 限制最大缓存数量
            .build();

    private ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    @PostConstruct
    public void init() {
        scheduler.scheduleWithFixedDelay(() -> {
            try {
                List<Topics> hotTopics = topicsService.getHotTopics();
                List<Topics> cachedTopics = topicsCache.getIfPresent(TOPICS_ALL);
                if (!hotTopics.equals(cachedTopics)) {
                    redisUtils.set(TOPICS_ALL, hotTopics);
                    topicsCache.put(FALL_BACK_TOPICS_ALL, hotTopics); // 更新本地备用缓存
                }
            } catch (Exception e) {
                logger.error("定时更新热门话题缓存失败: {}", e.getMessage());
            }
        }, 20, 30, TimeUnit.SECONDS);
    }

    /**
     * 获取热门话题列表（按热度排序）
     *
     * @return 热门话题列表
     */
    // 设计并实现了基于多级缓存（Caffeine + Redis）的热门话题高并发访问架构，结合定时任务更新、限
    // 流机制及降级策略，有效解决了热点数据高并发访问下的性能瓶颈和缓存一致性问题，提高系统的稳
    // 定性和响应效率。
    @ApiOperation("热门话题列表（按热度排序）")
    @GetMapping("/hot")
    public ApiResponse<List<Topics>> getHotTopics() {
        if (!topicsRateLimiter.tryAcquire()) {
            return ApiResponse.error(400, "请求过于频繁");
        }
        try {
            List<Topics> hotTopics = topicsCache.getIfPresent(TOPICS_ALL);
            if (hotTopics == null) {
                hotTopics = (List<Topics>) redisUtils.get(TOPICS_ALL);
                if (hotTopics == null) {
                    hotTopics = topicsService.getHotTopics();
                    redisUtils.set(TOPICS_ALL, hotTopics);
                }
                topicsCache.put(TOPICS_ALL, hotTopics);
            }
            return ApiResponse.success(hotTopics);
        } catch (Exception e) {
            logger.error(e.getMessage());
            return ApiResponse.success(topicsCache.getIfPresent(FALL_BACK_TOPICS_ALL));
        }
    }

    /**
     * 获取所有话题
     *
     * @param request HTTP请求对象
     * @return 包含所有话题列表的ApiResponse对象
     */
    @ApiOperation(value = "获取所有话题")
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

    /**
     * 根据ID获取话题
     *
     * @param id      话题ID
     * @param request HTTP请求对象
     * @return 包含话题详情的ApiResponse对象
     */
    @ApiOperation(value = "根据ID获取话题")
    @GetMapping("/{id}")
    public ApiResponse<Topics> getTopicById(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long id,
            HttpServletRequest request) {
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
                return ApiResponse.error(300, "话题不存在");
            }
        } catch (JsonProcessingException e) {
            throw new RuntimeException(e);
        }
    }

    /**
     * 新增话题
     *
     * @param topic 话题对象
     * @return 包含新增结果的ApiResponse对象
     */
    @ApiOperation(value = "新增话题")
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
                return ApiResponse.error(300, "新增话题成功");
            }
        } else {
            return ApiResponse.error(300, "该话题已存在");
        }
    }

    /**
     * 更新话题
     *
     * @param topic 话题对象
     * @return 包含更新结果的ApiResponse对象
     */
    @ApiOperation(value = "更新话题")
    @PutMapping("/update")
    public ApiResponse<String> updateTopic(@RequestBody Topics topic) {
        boolean isUpdated = topicsService.updateById(topic);
        if (isUpdated) {
            return ApiResponse.success("更新话题成功");
        } else {
            return ApiResponse.error(300, "更新话题失败");
        }
    }

    /**
     * 根据ID删除话题
     *
     * @param id 话题ID
     * @return 包含删除结果的ApiResponse对象
     */
    @ApiOperation(value = "根据ID删除话题")
    @DeleteMapping("/delete/{id}")
    public ApiResponse<String> deleteTopic(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long id) {
        boolean isDeleted = topicsService.removeById(id);
        if (isDeleted) {
            return ApiResponse.success("删除话题成功");
        } else {
            return ApiResponse.error(300, "删除话题失败");
        }
    }


    /**
     * 根据名称查询话题
     *
     * @param name 话题名称
     * @return 包含查询结果的ApiResponse对象
     */
    @ApiOperation(value = "根据名称查询话题")
    @GetMapping("/search")
    public ApiResponse<Topics> searchTopicsByName(
            @ApiParam(value = "话题名称", required = true) @RequestParam String name) {
        Topics topics = topicsService.getTopicsByName(name);
        return ApiResponse.success(topics);
    }

    /**
     * 批量删除话题
     *
     * @param ids 话题ID列表
     * @return 包含批量删除结果的ApiResponse对象
     */
    @ApiOperation(value = "批量删除话题")
    @DeleteMapping("/delete/batch")
    public ApiResponse<String> deleteBatch(@RequestBody List<Long> ids) {
        boolean isDeleted = topicsService.removeByIds(ids);
        if (isDeleted) {
            return ApiResponse.success("批量删除成功");
        } else {
            return ApiResponse.success("批量删除失败");
        }
    }
    /**
     * 从Redis缓存中获取话题
     *
     * @param id 话题ID
     * @return 包含缓存话题详情的ApiResponse对象
     */
    @ApiOperation(value = "从Redis缓存中获取话题")
    @GetMapping("/cache/{id}")
    public ApiResponse<Topics> getTopicFromCache(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long id) throws JsonProcessingException {
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
                return ApiResponse.error(300, "该帖子不存在");
            }
        }
    }

    /**
     * 根据热度值过滤话题
     *
     * @param minPopularity 最小热度值
     * @return 包含过滤后话题列表的ApiResponse对象
     */
    @ApiOperation(value = "根据热度值过滤话题")
    @GetMapping("/filterByPopularity")
    public ApiResponse<List<Topics>> filterByPopularity(
            @ApiParam(value = "最小热度值", required = true) @RequestParam Integer minPopularity) {
        List<Topics> filteredTopics = topicsService.filterByPopularity(minPopularity);
        return ApiResponse.success(filteredTopics);
    }

    /**
     * 获取话题趋势分析
     *
     * @param days 天数（默认7天）
     * @return 包含话题趋势分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题趋势分析")
    @GetMapping("/trends")
    public ApiResponse<List<Map<String, Object>>> getTopicTrends(
            @ApiParam(value = "天数（默认7天）", defaultValue = "7") @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(topicsService.getTopicTrends(days));
    }

    /**
     * 获取话题参与度分析
     *
     * @param topicId 话题ID
     * @return 包含话题参与度分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题参与度分析")
    @GetMapping("/{topicId}/engagement")
    public ApiResponse<Map<String, Object>> getTopicEngagement(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicEngagement(topicId));
    }

    /**
     * 获取相关话题推荐
     *
     * @param topicId 话题ID
     * @param limit   返回结果的数量限制（默认5）
     * @return 包含相关话题列表的ApiResponse对象
     */
    @ApiOperation(value = "获取相关话题推荐")
    @GetMapping("/{topicId}/related")
    public ApiResponse<List<Topics>> getRelatedTopics(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId,
            @ApiParam(value = "返回结果的数量限制（默认5）", defaultValue = "5") @RequestParam(defaultValue = "5") int limit) {
        return ApiResponse.success(topicsService.getRelatedTopics(topicId, limit));
    }

    /**
     * 获取用户话题偏好
     *
     * @param userId 用户ID
     * @return 包含用户话题偏好的ApiResponse对象
     */
    @ApiOperation(value = "获取用户话题偏好")
    @GetMapping("/user/{userId}/preferences")
    public ApiResponse<List<Map<String, Object>>> getUserTopicPreferences(
            @ApiParam(value = "用户ID", required = true) @PathVariable Long userId) {
        return ApiResponse.success(topicsService.getUserTopicPreferences(userId));
    }

    /**
     * 获取话题活跃时段分析
     *
     * @param topicId 话题ID
     * @return 包含话题活跃时段分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题活跃时段分析")
    @GetMapping("/{topicId}/active-time")
    public ApiResponse<Map<String, Object>> getTopicActiveTimeAnalysis(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicActiveTimeAnalysis(topicId));
    }

    /**
     * 获取话题质量评分
     *
     * @param topicId 话题ID
     * @return 包含话题质量评分结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题质量评分")
    @GetMapping("/{topicId}/quality-score")
    public ApiResponse<Map<String, Object>> getTopicQualityScore(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicQualityScore(topicId));
    }

    /**
     * 获取话题影响力分析
     *
     * @param topicId 话题ID
     * @return 包含话题影响力分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题影响力分析")
    @GetMapping("/{topicId}/influence")
    public ApiResponse<Map<String, Object>> getTopicInfluenceAnalysis(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicInfluenceAnalysis(topicId));
    }

    /**
     * 获取话题互动统计
     *
     * @param topicId 话题ID
     * @return 包含话题互动统计结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题互动统计")
    @GetMapping("/{topicId}/interaction-stats")
    public ApiResponse<Map<String, Object>> getTopicInteractionStats(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicInteractionStats(topicId));
    }

    /**
     * 获取话题传播路径分析
     *
     * @param topicId 话题ID
     * @return 包含话题传播路径分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题传播路径分析")
    @GetMapping("/{topicId}/spread-analysis")
    public ApiResponse<List<Map<String, Object>>> getTopicSpreadAnalysis(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicSpreadAnalysis(topicId));
    }

    /**
     * 获取话题情感分析
     *
     * @param topicId 话题ID
     * @return 包含话题情感分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题情感分析")
    @GetMapping("/{topicId}/sentiment")
    public ApiResponse<Map<String, Object>> getTopicSentimentAnalysis(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicSentimentAnalysis(topicId));
    }

    /**
     * 获取话题关键词分析
     *
     * @param topicId 话题ID
     * @return 包含话题关键词分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题关键词分析")
    @GetMapping("/{topicId}/keywords")
    public ApiResponse<List<Map<String, Object>>> getTopicKeywordAnalysis(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicKeywordAnalysis(topicId));
    }

    /**
     * 获取话题用户画像
     *
     * @param topicId 话题ID
     * @return 包含话题用户画像结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题用户画像")
    @GetMapping("/{topicId}/user-profile")
    public ApiResponse<Map<String, Object>> getTopicUserProfile(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicUserProfile(topicId));
    }

    /**
     * 获取话题地域分布
     *
     * @param topicId 话题ID
     * @return 包含话题地域分布结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题地域分布")
    @GetMapping("/{topicId}/region-distribution")
    public ApiResponse<Map<String, Object>> getTopicRegionDistribution(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicRegionDistribution(topicId));
    }

    /**
     * 获取话题生命周期分析
     *
     * @param topicId 话题ID
     * @return 包含话题生命周期分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题生命周期分析")
    @GetMapping("/{topicId}/lifecycle")
    public ApiResponse<Map<String, Object>> getTopicLifecycleAnalysis(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicLifecycleAnalysis(topicId));
    }

    /**
     * 批量更新话题热度
     *
     * @param topicIds 话题ID列表
     * @return 包含更新结果的ApiResponse对象
     */
    @ApiOperation(value = "批量更新话题热度")
    @PostMapping("/batch-update-popularity")
    public ApiResponse<Void> batchUpdatePopularity(
            @ApiParam(value = "话题ID列表", required = true) @RequestBody List<Long> topicIds) {
        topicsService.batchUpdatePopularity(topicIds);
        return ApiResponse.success(null);
    }

    /**
     * 合并相似话题
     *
     * @param sourceTopicId 源话题ID
     * @param targetTopicId 目标话题ID
     * @return 包含合并结果的ApiResponse对象
     */
    @ApiOperation(value = "合并相似话题")
    @PostMapping("/merge")
    public ApiResponse<Boolean> mergeTopics(
            @ApiParam(value = "源话题ID", required = true) @RequestParam Long sourceTopicId,
            @ApiParam(value = "目标话题ID", required = true) @RequestParam Long targetTopicId) {
        return ApiResponse.success(topicsService.mergeTopics(sourceTopicId, targetTopicId));
    }

    /**
     * 获取话题分类统计
     *
     * @return 包含话题分类统计结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题分类统计")
    @GetMapping("/category-stats")
    public ApiResponse<List<Map<String, Object>>> getTopicCategoryStats() {
        return ApiResponse.success(topicsService.getTopicCategoryStats());
    }


    /**
     * 获取话题质量分布
     *
     * @return 包含话题质量分布结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题质量分布")
    @GetMapping("/quality-distribution")
    public ApiResponse<Map<String, Object>> getTopicQualityDistribution() {
        return ApiResponse.success(topicsService.getTopicQualityDistribution());
    }

    /**
     * 获取话题成长趋势
     *
     * @param topicId 话题ID
     * @param days    天数（默认30天）
     * @return 包含话题成长趋势结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题成长趋势")
    @GetMapping("/{topicId}/growth-trend")
    public ApiResponse<List<Map<String, Object>>> getTopicGrowthTrend(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId,
            @ApiParam(value = "天数（默认30天）", defaultValue = "30") @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.success(topicsService.getTopicGrowthTrend(topicId, days));
    }

    /**
     * 获取话题参与用户排行
     *
     * @param topicId 话题ID
     * @param limit   返回结果的数量限制（默认10）
     * @return 包含话题参与用户排行结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题参与用户排行")
    @GetMapping("/{topicId}/user-ranking")
    public ApiResponse<List<Map<String, Object>>> getTopicUserRanking(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId,
            @ApiParam(value = "返回结果的数量限制（默认10）", defaultValue = "10") @RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.success(topicsService.getTopicUserRanking(topicId, limit));
    }

    /**
     * 获取话题互动高峰期
     *
     * @param topicId 话题ID
     * @param days    天数（默认7天）
     * @return 包含话题互动高峰期结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题互动高峰期")
    @GetMapping("/{topicId}/peak-times")
    public ApiResponse<List<Map<String, Object>>> getTopicPeakTimes(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId,
            @ApiParam(value = "天数（默认7天）", defaultValue = "7") @RequestParam(defaultValue = "7") int days) {
        return ApiResponse.success(topicsService.getTopicPeakTimes(topicId, days));
    }

    /**
     * 获取话题内容类型分布
     *
     * @param topicId 话题ID
     * @return 包含话题内容类型分布结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题内容类型分布")
    @GetMapping("/{topicId}/content-type-distribution")
    public ApiResponse<Map<String, Object>> getTopicContentTypeDistribution(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicContentTypeDistribution(topicId));
    }

    /**
     * 获取话题引用分析
     *
     * @param topicId 话题ID
     * @return 包含话题引用分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题引用分析")
    @GetMapping("/{topicId}/reference-analysis")
    public ApiResponse<List<Map<String, Object>>> getTopicReferenceAnalysis(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
        return ApiResponse.success(topicsService.getTopicReferenceAnalysis(topicId));
    }

    /**
     * 获取话题竞品分析
     *
     * @param topicId 话题ID
     * @return 包含话题竞品分析结果的ApiResponse对象
     */
    @ApiOperation(value = "获取话题竞品分析")
    @GetMapping("/{topicId}/competition-analysis")
    public ApiResponse<List<Map<String, Object>>> getTopicCompetitionAnalysis(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long topicId) {
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
