package com.foodrecord.controller.admin;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.utils.ExcelExportUtil;
import com.foodrecord.model.dto.FeedbackQueryDTO;
import com.foodrecord.model.entity.User;
import com.foodrecord.model.entity.UserFeedback;
import com.foodrecord.service.UserFeedbackService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import javax.validation.Valid;
import java.util.List;
import java.util.Map;

@RestController
@Api(tags = "管理用户反馈部分")
@RequestMapping("/api/admin/feedback")
public class AdminFeedbackController {

    @Resource
    private UserFeedbackService feedbackService;

    /**
     * 管理员获取所有反馈记录（分页）。
     *
     * @param page 页码（默认 1）
     * @param size 每页大小（默认 10）
     * @return 分页反馈记录
     */
    @GetMapping("/admin/all")
    @ApiOperation("管理员分页获取所有反馈记录")
    public ApiResponse<IPage<UserFeedback>> getAllFeedbacks(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ApiResponse.success(feedbackService.getAllFeedbacks(page, size));
    }

    /**
     * 管理员批量删除反馈记录。
     *
     * @param feedbackIds 要删除的反馈记录 ID 列表
     * @return 删除结果
     */
    @DeleteMapping("/admin/batch-delete")
    @ApiOperation("管理员批量删除反馈记录")
    public ApiResponse<Boolean> deleteFeedbacksBatch(@RequestBody List<Long> feedbackIds) {
        feedbackService.deleteFeedbacksBatch(feedbackIds);
        return ApiResponse.success(true);
    }

    /**
     * 高级查询用户反馈记录。
     *
     * @param queryDTO 查询条件
     * @return 符合条件的用户反馈列表
     */
    @PostMapping("/admin/query")
    @ApiOperation("管理员高级查询用户反馈记录")
    public ApiResponse<IPage<UserFeedback>> queryFeedbacks(@RequestBody @Valid FeedbackQueryDTO queryDTO) {
        return ApiResponse.success(feedbackService.queryFeedbacks(queryDTO));
    }

    /**
     * 导出用户反馈记录为 Excel 文件。
     *
     * @return 导出的文件路径或字节流
     */
    @GetMapping("/admin/export")
    @ApiOperation("管理员导出用户反馈记录为 Excel")
    public void exportFeedbacks(HttpServletResponse response) {
        List<UserFeedback> userFeedbacks = feedbackService.list();
        // 调用工具类将用户列表导出为CSV
        ExcelExportUtil.exportFeedbackToExcel(response, userFeedbacks);
    }

    /**
     * 修改用户反馈状态（如已处理、待处理）。
     *
     * @param feedbackId 反馈记录 ID
     * @param status     新的状态
     * @return 操作结果
     */
    @PutMapping("/admin/status/{feedbackId}")
    @ApiOperation("管理员修改用户反馈状态")
    public ApiResponse<Boolean> updateFeedbackStatus(@PathVariable Long feedbackId, @RequestParam String status) {
        feedbackService.updateFeedbackStatus(feedbackId, status);
        return ApiResponse.success(true);
    }

    /**
     * 统计用户反馈数据。
     *
     * @return 反馈统计信息
     */
    @GetMapping("/admin/stats")
    @ApiOperation("管理员查看用户反馈统计数据")
    public ApiResponse<Object> getFeedbackStats() {
        return ApiResponse.success(feedbackService.getFeedbackStats());
    }

    @GetMapping("/admin/analyze-sentiment")
    @ApiOperation("分析用户反馈情感分布")
    public ApiResponse<Map<String, Long>> analyzeSentiment() {
        Map<String, Long> sentimentStats = feedbackService.analyzeFeedbackSentiment();
        return ApiResponse.success(sentimentStats);
    }
}
