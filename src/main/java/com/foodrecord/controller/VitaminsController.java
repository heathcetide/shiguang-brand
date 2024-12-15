package com.foodrecord.controller;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.VitaminsDTO;
import com.foodrecord.model.entity.Vitamins;
import com.foodrecord.service.impl.VitaminsServiceImpl;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/vitamins")
public class VitaminsController {
    private final VitaminsServiceImpl vitaminsService;

    public VitaminsController(VitaminsServiceImpl vitaminsService) {
        this.vitaminsService = vitaminsService;
    }

    @GetMapping("/food/{foodId}")
    public ApiResponse<Vitamins> getVitaminsByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(vitaminsService.getVitaminsByFoodId(foodId));
    }

    @PostMapping
    public ApiResponse<Vitamins> createVitamins(@Valid @RequestBody VitaminsDTO vitaminsDTO) {
        return ApiResponse.success(vitaminsService.createVitamins(vitaminsDTO));
    }

    @PutMapping("/food/{foodId}")
    public ApiResponse<Vitamins> updateVitamins(
            @PathVariable Long foodId,
            @Valid @RequestBody VitaminsDTO vitaminsDTO) {
        return ApiResponse.success(vitaminsService.updateVitamins(foodId, vitaminsDTO));
    }

    @DeleteMapping("/food/{foodId}")
    public ApiResponse<Void> deleteVitamins(@PathVariable Long foodId) {
        vitaminsService.deleteVitamins(foodId);
        return ApiResponse.success(null);
    }
} 