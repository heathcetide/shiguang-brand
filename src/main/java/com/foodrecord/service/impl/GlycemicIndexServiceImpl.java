package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.GlycemicIndexMapper;
import com.foodrecord.model.dto.GlycemicIndexDTO;
import com.foodrecord.model.entity.GlycemicIndex;
import com.foodrecord.service.GlycemicIndexService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.List;

@Service
public class GlycemicIndexServiceImpl extends ServiceImpl<GlycemicIndexMapper, GlycemicIndex> implements GlycemicIndexService {

    @Resource
    private GlycemicIndexMapper glycemicIndexMapper;

    @Override
    public GlycemicIndex getByFoodId(Long foodId) {
        return glycemicIndexMapper.selectByFoodId(foodId);
    }

    @Override
    public List<GlycemicIndex> getByGIRange(Float minValue, Float maxValue) {
        return glycemicIndexMapper.selectByGIRange(minValue, maxValue);
    }

    @Override
    public List<GlycemicIndex> getByGLRange(Float minValue, Float maxValue) {
        return glycemicIndexMapper.selectByGLRange(minValue, maxValue);
    }

    @Override
    public List<GlycemicIndex> getByGILabel(String giLabel) {
        return glycemicIndexMapper.selectByGILabel(giLabel);
    }

    @Override
    public List<GlycemicIndex> getByGLLabel(String glLabel) {
        return glycemicIndexMapper.selectByGLLabel(glLabel);
    }

    @Override
    @Transactional
    public GlycemicIndex createOrUpdate(GlycemicIndexDTO dto) {
        GlycemicIndex glycemicIndex = getByFoodId(dto.getFoodId());
        if (glycemicIndex == null) {
            glycemicIndex = new GlycemicIndex();
            glycemicIndex.setFoodId(dto.getFoodId());
        }
        
        glycemicIndex.setGiValue(dto.getGiValue());
        glycemicIndex.setGiLabel(dto.getGiLabel());
        glycemicIndex.setGlValue(dto.getGlValue());
        glycemicIndex.setGlLabel(dto.getGlLabel());
        
        saveOrUpdate(glycemicIndex);
        return glycemicIndex;
    }
} 