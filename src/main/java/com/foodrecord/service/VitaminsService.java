package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.VitaminsDTO;
import com.foodrecord.model.entity.Vitamins;

public interface VitaminsService extends IService<Vitamins> {
    Vitamins getVitaminsByFoodId(Long foodId);

    Vitamins createVitamins(VitaminsDTO vitaminsDTO);

    Vitamins updateVitamins(Long foodId, VitaminsDTO vitaminsDTO);

    void deleteVitamins(Long foodId);
}
