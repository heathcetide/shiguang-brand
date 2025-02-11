package com.foodrecord.controller.admin;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.model.entity.Topics;
import com.foodrecord.service.TopicsService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/admin/posts")
@Api(tags = "管理员热点话题管理模块")
@RequireRole("ADMIN")
public class AdminTopicController {

    @Autowired
    private TopicsService topicsService;

    /**
     * 更新话题
     *
     * @param topic 话题对象
     * @return 包含更新结果的ApiResponse对象
     */
    @ApiOperation(value = "更新话题")
    @PutMapping("/update")
    public ApiResponse<String> updateTopic(@RequestBody Topics topic) {
        boolean isUpdated = topicsService.updateById(topic);
        if (isUpdated) {
            return ApiResponse.success("更新话题成功");
        } else {
            return ApiResponse.error(300, "更新话题失败");
        }
    }

    /**
     * 根据ID删除话题
     *
     * @param id 话题ID
     * @return 包含删除结果的ApiResponse对象
     */
    @ApiOperation(value = "根据ID删除话题")
    @DeleteMapping("/delete/{id}")
    public ApiResponse<String> deleteTopic(
            @ApiParam(value = "话题ID", required = true) @PathVariable Long id) {
        boolean isDeleted = topicsService.removeById(id);
        if (isDeleted) {
            return ApiResponse.success("删除话题成功");
        } else {
            return ApiResponse.error(300, "删除话题失败");
        }
    }

    /**
     * 批量删除话题
     *
     * @param ids 话题ID列表
     * @return 包含批量删除结果的ApiResponse对象
     */
    @ApiOperation(value = "批量删除话题")
    @DeleteMapping("/delete/batch")
    public ApiResponse<String> deleteBatch(@RequestBody List<Long> ids) {
        boolean isDeleted = topicsService.removeByIds(ids);
        if (isDeleted) {
            return ApiResponse.success("批量删除成功");
        } else {
            return ApiResponse.success("批量删除失败");
        }
    }
}
