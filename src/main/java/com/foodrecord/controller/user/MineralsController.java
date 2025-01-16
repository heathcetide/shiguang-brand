package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.MineralsDTO;
import com.foodrecord.model.entity.Minerals;
import com.foodrecord.service.MineralsService;
import com.foodrecord.service.impl.MineralsServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiImplicitParam;
import io.swagger.annotations.ApiImplicitParams;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;

@RestController
@RequestMapping("/api/minerals")
@Api(tags = "矿物质模块[不重要]")
public class MineralsController {

    @Resource
    private MineralsService mineralsService;

    /**
     * 根据食品ID获取矿物质信息
     *
     * @param foodId 食品ID
     * @return 包含矿物质信息的ApiResponse对象
     */
    @GetMapping("/food/{foodId}")
    @ApiOperation("根据食品ID获取矿物质信息")
    @ApiImplicitParam(name = "foodId", value = "食品ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<Minerals> getMineralsByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(mineralsService.getMineralsByFoodId(foodId));
    }

    /**
     * 创建新的矿物质信息
     *
     * @param mineralsDTO 矿物质信息DTO
     * @return 包含创建的矿物质信息的ApiResponse对象
     */
    @PostMapping
    @ApiOperation("创建新的矿物质信息")
    @ApiImplicitParam(name = "mineralsDTO", value = "矿物质信息DTO", required = true, dataType = "MineralsDTO", paramType = "body")
    public ApiResponse<Minerals> createMinerals(@Valid @RequestBody MineralsDTO mineralsDTO) {
        return ApiResponse.success(mineralsService.createMinerals(mineralsDTO));
    }

    /**
     * 更新指定食品ID的矿物质信息
     *
     * @param foodId 食品ID
     * @param mineralsDTO 矿物质信息DTO
     * @return 包含更新后的矿物质信息的ApiResponse对象
     */
    @PutMapping("/food/{foodId}")
    @ApiOperation("更新指定食品ID的矿物质信息")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "foodId", value = "食品ID", required = true, dataType = "Long", paramType = "path"),
            @ApiImplicitParam(name = "mineralsDTO", value = "矿物质信息DTO", required = true, dataType = "MineralsDTO", paramType = "body")
    })
    public ApiResponse<Minerals> updateMinerals(
            @PathVariable Long foodId,
            @Valid @RequestBody MineralsDTO mineralsDTO) {
        return ApiResponse.success(mineralsService.updateMinerals(foodId, mineralsDTO));
    }

    /**
     * 删除指定食品ID的矿物质信息
     *
     * @param foodId 食品ID
     * @return 包含删除结果的ApiResponse对象
     */
    @DeleteMapping("/food/{foodId}")
    @ApiOperation("删除指定食品ID的矿物质信息")
    @ApiImplicitParam(name = "foodId", value = "食品ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<Void> deleteMinerals(@PathVariable Long foodId) {
        mineralsService.deleteMinerals(foodId);
        return ApiResponse.success(null);
    }
} 