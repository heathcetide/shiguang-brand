package com.foodrecord.controller.user;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.dto.UserFeedbackDTO;
import com.foodrecord.model.entity.UserFeedback;
import com.foodrecord.service.UserFeedbackService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.List;

/**
 * 用户反馈控制器
 */
@RestController
@Api(tags = "用户反馈模块")
@RequestMapping("/api/feedback")
public class UserFeedbackController {

    @Resource
    private UserFeedbackService feedbackService;

    /**
     * 根据食物 ID 获取该食物的所有用户反馈。
     *
     * @param foodId 食物 ID
     * @return 包含用户反馈列表的响应对象
     */
    @GetMapping("/food/{foodId}")
    @ApiOperation("根据食物 ID 获取该食物的所有用户反馈")
    public ApiResponse<List<UserFeedback>> getByFoodId(@PathVariable Long foodId) {
        return ApiResponse.success(feedbackService.getByFoodId(foodId));
    }

    /**
     * 分页获取指定食物的用户反馈。
     *
     * @param foodId 食物 ID
     * @param page   页码（默认值为 1）
     * @param size   每页大小（默认值为 10）
     * @return 包含分页反馈信息的响应对象
     */
    @GetMapping("/food/{foodId}/page")
    @ApiOperation("分页获取指定食物的用户反馈")
    public ApiResponse<IPage<UserFeedback>> getPageByFoodId(
            @PathVariable Long foodId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ApiResponse.success(feedbackService.getPageByFoodId(foodId, page, size));
    }

    /**
     * 根据用户 ID 获取该用户的所有反馈记录。
     *
     * @param userId 用户 ID
     * @return 包含用户反馈列表的响应对象
     */
    @GetMapping("/user/{userId}")
    @ApiOperation("根据用户 ID 获取该用户的所有反馈记录")
    public ApiResponse<List<UserFeedback>> getByUserId(@PathVariable Long userId) {
        return ApiResponse.success(feedbackService.getByUserId(userId));
    }

    /**
     * 获取指定食物的平均评分。
     *
     * @param foodId 食物 ID
     * @return 包含平均评分的响应对象
     */
    @GetMapping("/food/{foodId}/rating")
    @ApiOperation("获取指定食物的平均评分")
    public ApiResponse<Double> getAvgRating(@PathVariable Long foodId) {
        return ApiResponse.success(feedbackService.getAvgRatingByFoodId(foodId));
    }

    /**
     * 创建用户反馈记录。
     *
     * @param userId 用户 ID
     * @param dto    用户反馈数据传输对象（包括评分、评论等）
     * @return 创建成功的用户反馈记录
     */
    @PostMapping("/user/{userId}")
    @ApiOperation("创建用户反馈记录")
    public ApiResponse<UserFeedback> createFeedback(
            @PathVariable Long userId,
            @Valid @RequestBody UserFeedbackDTO dto) {
        return ApiResponse.success(feedbackService.createFeedback(userId, dto));
    }

    /**
     * 更新用户反馈记录。
     *
     * @param userId     用户 ID
     * @param feedbackId 反馈记录 ID
     * @param dto        更新的用户反馈数据
     * @return 更新后的用户反馈记录
     */
    @PutMapping("/user/{userId}/{feedbackId}")
    @ApiOperation("更新用户反馈记录")
    public ApiResponse<UserFeedback> updateFeedback(
            @PathVariable Long userId,
            @PathVariable Long feedbackId,
            @Valid @RequestBody UserFeedbackDTO dto) {
        return ApiResponse.success(feedbackService.updateFeedback(userId, feedbackId, dto));
    }

    /**
     * 删除指定的用户反馈记录。
     *
     * @param userId     用户 ID
     * @param feedbackId 反馈记录 ID
     * @return 删除结果（true 表示删除成功）
     */
    @DeleteMapping("/user/{userId}/{feedbackId}")
    @ApiOperation("删除指定的用户反馈记录")
    public ApiResponse<Boolean> deleteFeedback(
            @PathVariable Long userId,
            @PathVariable Long feedbackId) {
        feedbackService.deleteFeedback(userId, feedbackId);
        return ApiResponse.success(true);
    }
}
