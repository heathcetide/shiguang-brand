package com.foodrecord.controller;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.RankingsDTO;
import com.foodrecord.model.entity.Rankings;
import com.foodrecord.service.impl.RankingsServiceImpl;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/rankings")
public class RankingsController {
    private final RankingsServiceImpl rankingsService;

    public RankingsController(RankingsServiceImpl rankingsService) {
        this.rankingsService = rankingsService;
    }

    @GetMapping("/{rankType}")
    public ApiResponse<List<Rankings>> getByRankType(
            @PathVariable String rankType,
            @RequestParam(defaultValue = "10") Integer limit) {
        return ApiResponse.success(rankingsService.getByRankType(rankType, limit));
    }

    @GetMapping("/food/{foodId}/{rankType}")
    public ApiResponse<Rankings> getByFoodIdAndType(
            @PathVariable Long foodId,
            @PathVariable String rankType) {
        return ApiResponse.success(rankingsService.getByFoodIdAndType(foodId, rankType));
    }

    @PostMapping
    public ApiResponse<Rankings> createOrUpdate(@Valid @RequestBody RankingsDTO dto) {
        return ApiResponse.success(rankingsService.createOrUpdate(dto));
    }

    @PutMapping("/{rankType}/{foodId}/score")
    public ApiResponse<Boolean> updateScore(
            @PathVariable String rankType,
            @PathVariable Long foodId,
            @RequestParam Double score) {
        rankingsService.updateScore(rankType, foodId, score);
        return ApiResponse.success(true);
    }
} 