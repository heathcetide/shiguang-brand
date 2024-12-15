package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.common.exception.CustomException;
import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.mapper.MineralsMapper;
import com.foodrecord.model.dto.MineralsDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.Minerals;
import com.foodrecord.service.MineralsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class MineralsServiceImpl extends ServiceImpl<MineralsMapper, Minerals> implements MineralsService {
    @Resource
    private MineralsMapper mineralsMapper;

    @Resource
    private FoodMapper foodMapper;

    public Minerals getMineralsByFoodId(Long foodId) {
        return mineralsMapper.findByFoodId(foodId)
                .orElseThrow(() -> new CustomException("矿物质信息不存在"));
    }

    @Transactional
    public Minerals createMinerals(MineralsDTO mineralsDTO) {
        Food food = foodMapper.findById(mineralsDTO.getFoodId());
        if (food == null) {
            throw new CustomException("食物不存在");
        }

        if (mineralsMapper.findByFoodId(mineralsDTO.getFoodId()).isPresent()) {
            throw new CustomException("该食物的矿物质信息已存在");
        }

        Minerals minerals = new Minerals();
        minerals.setFood(food);
        updateMineralsFromDTO(minerals, mineralsDTO);
        mineralsMapper.insert(minerals);
        return minerals;
    }

    @Transactional
    public Minerals updateMinerals(Long foodId, MineralsDTO mineralsDTO) {
        Minerals minerals = getMineralsByFoodId(foodId);
        updateMineralsFromDTO(minerals, mineralsDTO);
        mineralsMapper.insert(minerals);
        return minerals;
    }

    public void updateMineralsFromDTO(Minerals minerals, MineralsDTO dto) {
        minerals.setPhosphor(dto.getPhosphor());
        minerals.setKalium(dto.getKalium());
        minerals.setMagnesium(dto.getMagnesium());
        minerals.setCalcium(dto.getCalcium());
        minerals.setIron(dto.getIron());
        minerals.setZinc(dto.getZinc());
        minerals.setIodine(dto.getIodine());
        minerals.setSelenium(dto.getSelenium());
        minerals.setCopper(dto.getCopper());
        minerals.setFluorine(dto.getFluorine());
        minerals.setManganese(dto.getManganese());
    }

    @Transactional
    public void deleteMinerals(Long foodId) {
        Minerals minerals = getMineralsByFoodId(foodId);
        mineralsMapper.deleteMinerals(minerals.getId());
    }
} 