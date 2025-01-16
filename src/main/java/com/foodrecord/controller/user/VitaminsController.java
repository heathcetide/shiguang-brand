package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.VitaminsDTO;
import com.foodrecord.model.entity.Vitamins;
import com.foodrecord.service.VitaminsService;
import com.foodrecord.service.impl.VitaminsServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;

/**
 * 维他命控制器
 * 提供获取、创建、更新和删除维他命信息的功能
 */
@RestController
@RequestMapping("/api/vitamins")
@Api(tags = "维他命模块[不重要]")
public class VitaminsController {

    @Resource
    private VitaminsService vitaminsService;

    /**
     * 根据食物ID获取维他命信息
     *
     * @param foodId 食物ID
     * @return 包含维他命信息的ApiResponse对象
     */
    @GetMapping("/food/{foodId}")
    @ApiOperation("根据食物ID获取维他命信息")
    public ApiResponse<Vitamins> getVitaminsByFoodId(
            @ApiParam(value = "食物ID", required = true) @PathVariable Long foodId) {
        return ApiResponse.success(vitaminsService.getVitaminsByFoodId(foodId));
    }

    /**
     * 创建新的维他命信息
     *
     * @param vitaminsDTO 维他命DTO对象
     * @return 包含创建结果的ApiResponse对象
     */
    @PostMapping
    @ApiOperation("创建新的维他命信息")
    public ApiResponse<Vitamins> createVitamins(
            @ApiParam(value = "维他命DTO对象", required = true) @Valid @RequestBody VitaminsDTO vitaminsDTO) {
        return ApiResponse.success(vitaminsService.createVitamins(vitaminsDTO));
    }

    /**
     * 根据食物ID更新维他命信息
     *
     * @param foodId      食物ID
     * @param vitaminsDTO 维他命DTO对象
     * @return 包含更新结果的ApiResponse对象
     */
    @PutMapping("/food/{foodId}")
    @ApiOperation("根据食物ID更新维他命信息")
    public ApiResponse<Vitamins> updateVitamins(
            @ApiParam(value = "食物ID", required = true) @PathVariable Long foodId,
            @ApiParam(value = "维他命DTO对象", required = true) @Valid @RequestBody VitaminsDTO vitaminsDTO) {
        return ApiResponse.success(vitaminsService.updateVitamins(foodId, vitaminsDTO));
    }

    /**
     * 根据食物ID删除维他命信息
     *
     * @param foodId 食物ID
     * @return 包含删除结果的ApiResponse对象
     */
    @DeleteMapping("/food/{foodId}")
    @ApiOperation("根据食物ID删除维他命信息")
    public ApiResponse<Void> deleteVitamins(
            @ApiParam(value = "食物ID", required = true) @PathVariable Long foodId) {
        vitaminsService.deleteVitamins(foodId);
        return ApiResponse.success(null);
    }
}
