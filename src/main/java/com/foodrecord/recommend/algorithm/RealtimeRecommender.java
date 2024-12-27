package com.foodrecord.recommend.algorithm;

import com.foodrecord.recommend.model.RecommendDTO;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.util.*;
import java.util.stream.Collectors;

@Component
public class RealtimeRecommender {

    @Resource
    private RedisTemplate<String, String> redisTemplate;

    private static final String USER_BEHAVIOR_KEY = "user:behavior:";
    private static final String ITEM_SIMILARITY_KEY = "item:similarity:";
    private static final String USER_SIMILARITY_KEY = "user:similarity:";
    private static final String HOT_ITEMS_KEY = "hot:items";

    /**
     * 基于用户行为的实时推荐
     */
    public List<RecommendDTO> recommendByUserBehavior(Long userId, int limit) {
        // 1. 获取用户最近行为
        Map<String, Double> recentBehaviors = getUserRecentBehaviors(userId);
        
        // 2. 获取相似物品
        List<RecommendDTO> recommendations = new ArrayList<>();
        for (Map.Entry<String, Double> entry : recentBehaviors.entrySet()) {
            String itemId = entry.getKey();
            Double score = entry.getValue();
            
            // 获取相似物品
            Map<String, Double> similarItems = getSimilarItems(itemId);
            for (Map.Entry<String, Double> simEntry : similarItems.entrySet()) {
                recommendations.add(new RecommendDTO(
                    Long.parseLong(simEntry.getKey()),
                    score * simEntry.getValue()
                ));
            }
        }
        
        // 3. 排序和去重
        return recommendations.stream()
                .collect(Collectors.groupingBy(RecommendDTO::getItemId,
                        Collectors.summingDouble(RecommendDTO::getScore)))
                .entrySet().stream()
                .map(e -> new RecommendDTO(e.getKey(), e.getValue()))
                .sorted(Comparator.comparing(RecommendDTO::getScore).reversed())
                .limit(limit)
                .collect(Collectors.toList());
    }

    /**
     * 基于热度的实时推荐
     */
    public List<RecommendDTO> recommendByHotItems(int limit) {
        // 1. 获取热门物品列表
        Set<String> hotItems = redisTemplate.opsForZSet().reverseRange(HOT_ITEMS_KEY, 0, limit - 1);
        
        // 2. 转换为推荐对象
        return hotItems.stream()
                .map(itemId -> {
                    Double score = redisTemplate.opsForZSet().score(HOT_ITEMS_KEY, itemId);
                    return new RecommendDTO(Long.parseLong(itemId), score != null ? score : 0.0);
                })
                .collect(Collectors.toList());
    }

    /**
     * 更新用户行为
     */
    public void updateUserBehavior(Long userId, Long itemId, String action, double score) {
        // 1. 更新用户行为记录
        String key = USER_BEHAVIOR_KEY + userId;
        redisTemplate.opsForHash().put(key, itemId.toString(), score);
        
        // 2. 更新物品热度
        redisTemplate.opsForZSet().incrementScore(HOT_ITEMS_KEY, itemId.toString(), score);
        
        // 3. 异步更新相似度矩阵
        updateSimilarityMatrix(userId, itemId);
    }

    private Map<String, Double> getUserRecentBehaviors(Long userId) {
        String key = USER_BEHAVIOR_KEY + userId;
        Map<Object, Object> behaviors = redisTemplate.opsForHash().entries(key);
        
        Map<String, Double> result = new HashMap<>();
        behaviors.forEach((k, v) -> result.put(k.toString(), Double.parseDouble(v.toString())));
        return result;
    }

    private Map<String, Double> getSimilarItems(String itemId) {
        String key = ITEM_SIMILARITY_KEY + itemId;
        Map<Object, Object> similarities = redisTemplate.opsForHash().entries(key);
        
        Map<String, Double> result = new HashMap<>();
        similarities.forEach((k, v) -> result.put(k.toString(), Double.parseDouble(v.toString())));
        return result;
    }

    private void updateSimilarityMatrix(Long userId, Long itemId) {
        // TODO: 实现基于协同过滤的相似度矩阵更新
        // 1. 更新物品相似度
        // 2. 更新用户相似度
    }
} 