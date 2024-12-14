package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.MineralsDTO;
import com.foodrecord.model.entity.Minerals;

public interface MineralsService extends IService<Minerals> {

    Minerals getMineralsByFoodId(Long foodId);

    Minerals createMinerals(MineralsDTO mineralsDTO);

    Minerals updateMinerals(Long foodId, MineralsDTO mineralsDTO);

    void updateMineralsFromDTO(Minerals minerals, MineralsDTO dto);

    void deleteMinerals(Long foodId);
}
