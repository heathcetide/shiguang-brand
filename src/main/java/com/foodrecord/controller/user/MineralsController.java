package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.MineralsDTO;
import com.foodrecord.model.entity.Minerals;
import com.foodrecord.service.impl.MineralsServiceImpl;
import io.swagger.annotations.Api;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;

@RestController
@RequestMapping("/api/minerals")
@Api(tags = "矿物质模块[不重要]")
public class MineralsController {
    private final MineralsServiceImpl mineralsService;

    public MineralsController(MineralsServiceImpl mineralsService) {
        this.mineralsService = mineralsService;
    }

    @GetMapping("/food/{foodId}")
    public ApiResponse<Minerals> getMineralsByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(mineralsService.getMineralsByFoodId(foodId));
    }

    @PostMapping
    public ApiResponse<Minerals> createMinerals(@Valid @RequestBody MineralsDTO mineralsDTO) {
        return ApiResponse.success(mineralsService.createMinerals(mineralsDTO));
    }

    @PutMapping("/food/{foodId}")
    public ApiResponse<Minerals> updateMinerals(
            @PathVariable Long foodId,
            @Valid @RequestBody MineralsDTO mineralsDTO) {
        return ApiResponse.success(mineralsService.updateMinerals(foodId, mineralsDTO));
    }

    @DeleteMapping("/food/{foodId}")
    public ApiResponse<Void> deleteMinerals(@PathVariable Long foodId) {
        mineralsService.deleteMinerals(foodId);
        return ApiResponse.success(null);
    }
} 