package com.foodrecord.controller;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.GlycemicIndexDTO;
import com.foodrecord.model.entity.GlycemicIndex;
import com.foodrecord.service.impl.GlycemicIndexServiceImpl;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/glycemic-index")
public class GlycemicIndexController {
    private final GlycemicIndexServiceImpl glycemicIndexService;

    public GlycemicIndexController(GlycemicIndexServiceImpl glycemicIndexService) {
        this.glycemicIndexService = glycemicIndexService;
    }

    @GetMapping("/food/{foodId}")
    public ApiResponse<GlycemicIndex> getByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(glycemicIndexService.getByFoodId(foodId));
    }

    @GetMapping("/gi-range")
    public ApiResponse<List<GlycemicIndex>> getByGIRange(
            @RequestParam Float minValue,
            @RequestParam Float maxValue) {
        return ApiResponse.success(glycemicIndexService.getByGIRange(minValue, maxValue));
    }

    @GetMapping("/gl-range")
    public ApiResponse<List<GlycemicIndex>> getByGLRange(
            @RequestParam Float minValue,
            @RequestParam Float maxValue) {
        return ApiResponse.success(glycemicIndexService.getByGLRange(minValue, maxValue));
    }

    @GetMapping("/gi-label/{label}")
    public ApiResponse<List<GlycemicIndex>> getByGILabel(@PathVariable String label) {
        return ApiResponse.success(glycemicIndexService.getByGILabel(label));
    }

    @GetMapping("/gl-label/{label}")
    public ApiResponse<List<GlycemicIndex>> getByGLLabel(@PathVariable String label) {
        return ApiResponse.success(glycemicIndexService.getByGLLabel(label));
    }

    @PostMapping
    public ApiResponse<GlycemicIndex> createOrUpdate(@Valid @RequestBody GlycemicIndexDTO dto) {
        return ApiResponse.success(glycemicIndexService.createOrUpdate(dto));
    }
} 