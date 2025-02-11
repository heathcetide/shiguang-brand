package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.exception.CustomException;
import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.mapper.VitaminsMapper;
import com.foodrecord.model.dto.VitaminsDTO;
import com.foodrecord.model.entity.Food;
import com.foodrecord.model.entity.Vitamins;
import com.foodrecord.service.VitaminsService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class VitaminsServiceImpl extends ServiceImpl<VitaminsMapper, Vitamins> implements VitaminsService {
    @Resource
    private VitaminsMapper vitaminsMapper;
    @Resource
    private FoodMapper foodMapper;

    public Vitamins getVitaminsByFoodId(Long foodId) {
        Vitamins byFoodId = vitaminsMapper.findByFoodId(foodId);
        if (byFoodId == null) {
            throw new CustomException("维生素信息不存在");
        }
        return byFoodId;
    }

    @Transactional
    public Vitamins createVitamins(VitaminsDTO vitaminsDTO) {
        Food food = foodMapper.findById(vitaminsDTO.getFoodId());
        if (food == null) {
           throw new CustomException("食物不存在");
        }
        Vitamins byFoodId = vitaminsMapper.findByFoodId(vitaminsDTO.getFoodId());
        if (byFoodId != null) {
            throw new CustomException("该食物的维生素信息已存在");
        }

        Vitamins vitamins = new Vitamins();
        vitamins.setFood(food);
        updateVitaminsFromDTO(vitamins, vitaminsDTO);
        vitaminsMapper.insert(vitamins);
        return vitamins;
    }

    @Transactional
    public Vitamins updateVitamins(Long foodId, VitaminsDTO vitaminsDTO) {
        Vitamins vitamins = getVitaminsByFoodId(foodId);
        updateVitaminsFromDTO(vitamins, vitaminsDTO);
        vitaminsMapper.insert(vitamins);
        return vitamins;
    }

    private void updateVitaminsFromDTO(Vitamins vitamins, VitaminsDTO dto) {
        vitamins.setVitaminA(dto.getVitaminA());
        vitamins.setCarotene(dto.getCarotene());
        vitamins.setVitaminD(dto.getVitaminD());
        vitamins.setVitaminE(dto.getVitaminE());
        vitamins.setThiamine(dto.getThiamine());
        vitamins.setLactoflavin(dto.getLactoflavin());
        vitamins.setVitaminC(dto.getVitaminC());
        vitamins.setNiacin(dto.getNiacin());
        vitamins.setRetinol(dto.getRetinol());
    }

    @Transactional
    public void deleteVitamins(Long foodId) {
        Vitamins vitamins = getVitaminsByFoodId(foodId);
        vitaminsMapper.deleteVitamins(vitamins.getId());
    }
} 