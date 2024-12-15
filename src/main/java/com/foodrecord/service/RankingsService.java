package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.RankingsDTO;
import com.foodrecord.model.entity.Rankings;

import java.util.List;

public interface RankingsService extends IService<Rankings> {

    List<Rankings> getByRankType(String rankType, Integer limit);

    Rankings getByFoodIdAndType(Long foodId, String rankType);

    Rankings createOrUpdate(RankingsDTO dto);

    void updateScore(String rankType, Long foodId, Double score);
}
