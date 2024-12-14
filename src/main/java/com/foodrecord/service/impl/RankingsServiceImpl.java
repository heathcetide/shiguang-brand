package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.utils.RedisUtils;
import com.foodrecord.mapper.RankingsMapper;
import com.foodrecord.model.dto.RankingsDTO;
import com.foodrecord.model.entity.Rankings;
import com.foodrecord.service.RankingsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.List;

@Service
public class RankingsServiceImpl extends ServiceImpl<RankingsMapper, Rankings> implements RankingsService {
    @Resource
    private RankingsMapper rankingsMapper;
    @Resource
    private RedisUtils redisUtils;
    
    private static final String RANKINGS_CACHE_KEY = "rankings:";
    private static final long CACHE_TIME = 3600; // 1小时

    @Override
    public List<Rankings> getByRankType(String rankType, Integer limit) {
        String key = RANKINGS_CACHE_KEY + rankType + ":" + limit;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (List<Rankings>) cached;
        }
        
        List<Rankings> rankings = rankingsMapper.selectByRankType(rankType, limit);
        redisUtils.set(key, rankings, CACHE_TIME);
        return rankings;
    }

    @Override
    public Rankings getByFoodIdAndType(Long foodId, String rankType) {
        String key = RANKINGS_CACHE_KEY + "food:" + foodId + ":" + rankType;
        Object cached = redisUtils.get(key);
        if (cached != null) {
            return (Rankings) cached;
        }
        
        Rankings ranking = rankingsMapper.selectByFoodIdAndType(foodId, rankType);
        if (ranking != null) {
            redisUtils.set(key, ranking, CACHE_TIME);
        }
        return ranking;
    }

    @Override
    @Transactional
    public Rankings createOrUpdate(RankingsDTO dto) {
        Rankings ranking = getByFoodIdAndType(dto.getFoodId(), dto.getRankType());
        if (ranking == null) {
            ranking = new Rankings();
            ranking.setFoodId(dto.getFoodId());
            ranking.setRankType(dto.getRankType());
        }
        
        ranking.setRankScore(dto.getRankScore());
        ranking.setRankPosition(dto.getRankPosition());
        
        saveOrUpdate(ranking);
        
        // 更新排名
        rankingsMapper.updateRankings(dto.getRankType(), dto.getFoodId(), dto.getRankScore());
        
        // 清除相关缓存
        clearRankingsCache(dto.getRankType(), dto.getFoodId());
        
        return ranking;
    }

    @Override
    @Transactional
    public void updateScore(String rankType, Long foodId, Double score) {
        rankingsMapper.updateRankings(rankType, foodId, score);
        clearRankingsCache(rankType, foodId);
    }

    private void clearRankingsCache(String rankType, Long foodId) {
        // 清除排名列表缓存
        redisUtils.delete(RANKINGS_CACHE_KEY + rankType + ":*");
        // 清除单个排名缓存
        redisUtils.delete(RANKINGS_CACHE_KEY + "food:" + foodId + ":" + rankType);
    }
} 