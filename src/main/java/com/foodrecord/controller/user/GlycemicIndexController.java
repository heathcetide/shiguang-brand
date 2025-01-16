package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.GlycemicIndexDTO;
import com.foodrecord.model.entity.GlycemicIndex;
import com.foodrecord.service.GlycemicIndexService;
import com.foodrecord.service.impl.GlycemicIndexServiceImpl;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiImplicitParam;
import io.swagger.annotations.ApiImplicitParams;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.List;

@RestController
@RequestMapping("/api/glycemic-index")
@Api(tags = "血糖指标模块[不重要]")
public class GlycemicIndexController {

    @Resource
    private GlycemicIndexService glycemicIndexService;

    /**
     * 根据食品ID获取血糖指数信息
     *
     * @param foodId 食品ID
     * @return 包含血糖指数信息的ApiResponse对象
     */
    @GetMapping("/food/{foodId}")
    @ApiOperation("根据食品ID获取血糖指数信息")
    @ApiImplicitParam(name = "foodId", value = "食品ID", required = true, dataType = "Long", paramType = "path")
    public ApiResponse<GlycemicIndex> getByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(glycemicIndexService.getByFoodId(foodId));
    }

    /**
     * 根据GL范围获取血糖指数信息
     *
     * @param minValue GL最小值
     * @param maxValue GL最大值
     * @return 包含血糖指数信息列表的ApiResponse对象
     */
    @GetMapping("/gl-range")
    @ApiOperation("根据GL范围获取血糖指数信息")
    @ApiImplicitParams({
            @ApiImplicitParam(name = "minValue", value = "GL最小值", required = true, dataType = "Float", paramType = "query"),
            @ApiImplicitParam(name = "maxValue", value = "GL最大值", required = true, dataType = "Float", paramType = "query")
    })
    public ApiResponse<List<GlycemicIndex>> getByGLRange(
            @RequestParam Float minValue,
            @RequestParam Float maxValue) {
        return ApiResponse.success(glycemicIndexService.getByGLRange(minValue, maxValue));
    }


    /**
     * 根据GI标签获取血糖指数信息
     *
     * @param label GI标签
     * @return 包含血糖指数信息列表的ApiResponse对象
     */
    @GetMapping("/gi-label/{label}")
    @ApiOperation("根据GI标签获取血糖指数信息")
    @ApiImplicitParam(name = "label", value = "GI标签", required = true, dataType = "String", paramType = "path")
    public ApiResponse<List<GlycemicIndex>> getByGILabel(@PathVariable String label) {
        return ApiResponse.success(glycemicIndexService.getByGILabel(label));
    }

    /**
     * 根据GL标签获取血糖指数信息
     *
     * @param label GL标签
     * @return 包含血糖指数信息列表的ApiResponse对象
     */
    @GetMapping("/gl-label/{label}")
    @ApiOperation("根据GL标签获取血糖指数信息")
    @ApiImplicitParam(name = "label", value = "GL标签", required = true, dataType = "String", paramType = "path")
    public ApiResponse<List<GlycemicIndex>> getByGLLabel(@PathVariable String label) {
        return ApiResponse.success(glycemicIndexService.getByGLLabel(label));
    }

    /**
     * 创建或更新血糖指数信息
     *
     * @param dto 血糖指数信息DTO
     * @return 包含创建或更新后的血糖指数信息的ApiResponse对象
     */
    @PostMapping
    @ApiOperation("创建或更新血糖指数信息")
    @ApiImplicitParam(name = "dto", value = "血糖指数信息DTO", required = true, dataType = "GlycemicIndexDTO", paramType = "body")
    public ApiResponse<GlycemicIndex> createOrUpdate(@Valid @RequestBody GlycemicIndexDTO dto) {
        return ApiResponse.success(glycemicIndexService.createOrUpdate(dto));
    }
} 