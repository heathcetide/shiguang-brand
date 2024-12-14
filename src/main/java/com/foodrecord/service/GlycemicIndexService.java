package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.GlycemicIndexDTO;
import com.foodrecord.model.entity.GlycemicIndex;

import java.util.List;

public interface GlycemicIndexService extends IService<GlycemicIndex> {
    GlycemicIndex createOrUpdate(GlycemicIndexDTO dto);


    List<GlycemicIndex> getByGLLabel(String glLabel);

    List<GlycemicIndex> getByGILabel(String giLabel);

    List<GlycemicIndex> getByGLRange(Float minValue, Float maxValue);

    List<GlycemicIndex> getByGIRange(Float minValue, Float maxValue);

    GlycemicIndex getByFoodId(Long foodId);
}
