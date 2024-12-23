package com.foodrecord.controller.admin;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.common.utils.ExcelExportUtil;
import com.foodrecord.model.dto.FeedbackQueryDTO;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.entity.user.UserFeedback;
import com.foodrecord.model.vo.SentimentAnalysisResult;
import com.foodrecord.service.UserFeedbackService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import javax.validation.Valid;
import java.util.List;


@RestController
@Api(tags = "管理用户反馈部分")
@RequestMapping("/api/admin/feedback")
public class AdminFeedbackController {

    @Resource
    private UserFeedbackService feedbackService;

    /**
     * 分页获取用户反馈记录
     *
     * @param page 页码，默认值为 1
     * @param size 每页记录数，默认值为 10
     * @param keyword 可选关键字，用于模糊搜索反馈内容
     * @return 分页的反馈记录
     */
    @GetMapping("/admin/all")
    @ApiOperation(value = "管理员分页获取所有反馈记录", notes = "管理员可以分页获取用户的反馈记录，并支持通过关键字搜索反馈内容")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Page<UserFeedback>> getAllFeedbacks(
            @ApiParam(value = "页码，从1开始", example = "1")
            @RequestParam(defaultValue = "1") int page,

            @ApiParam(value = "每页记录数，默认10", example = "10")
            @RequestParam(defaultValue = "10") int size,

            @ApiParam(value = "关键字搜索反馈内容", example = "问题反馈")
            @RequestParam(value = "keyword", required = false) String keyword) {
        Page<UserFeedback> userFeedbackPage = feedbackService.getFeedbacks(new Page<>(page, size), keyword);
        return ApiResponse.success(userFeedbackPage);
    }

    /**
     * 批量删除反馈记录
     *
     * @param feedbackIds 需要删除的反馈记录ID列表
     * @return 删除结果
     */
    @DeleteMapping("/admin/batch-delete")
    @ApiOperation(value = "管理员批量删除反馈记录", notes = "根据反馈ID列表批量删除反馈记录")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> deleteFeedbacksBatch(
            @ApiParam(value = "反馈ID列表", example = "[1, 2, 3]", required = true)
            @RequestBody List<Long> feedbackIds) {
        feedbackService.deleteFeedbacksBatch(feedbackIds);
        return ApiResponse.success(true);
    }

    /**
     * 高级查询用户反馈记录
     *
     * @param queryDTO 高级查询条件，包含分页参数、时间范围和其他过滤条件
     * @return 符合条件的反馈记录列表
     */
    @PostMapping("/admin/query")
    @ApiOperation(value = "管理员高级查询用户反馈记录", notes = "通过多条件查询用户反馈记录，支持分页和多种过滤条件")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<IPage<UserFeedback>> queryFeedbacks(
            @ApiParam(value = "查询条件DTO", required = true)
            @RequestBody @Valid FeedbackQueryDTO queryDTO) {
        return ApiResponse.success(feedbackService.queryFeedbacks(queryDTO));
    }

    /**
     * 导出用户反馈记录为 Excel 文件
     *
     * @param response HTTP 响应对象，用于返回生成的文件
     */
    @GetMapping("/admin/export")
    @ApiOperation(value = "管理员导出用户反馈记录为 Excel", notes = "导出所有用户反馈记录到 Excel 文件中")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public void exportFeedbacks(
            @ApiParam(value = "HTTP 响应对象，用于输出文件", hidden = true)
            HttpServletResponse response) {
        List<UserFeedback> userFeedbacks = feedbackService.list();
        ExcelExportUtil.exportFeedbackToExcel(response, userFeedbacks);
    }

    /**
     * 修改用户反馈状态
     *
     * @param feedbackId 反馈记录的ID
     * @param status 新的状态值，例如“已处理”或“待处理”
     * @return 操作结果
     */
    @PutMapping("/admin/status/{feedbackId}")
    @ApiOperation(value = "管理员修改用户反馈状态", notes = "通过反馈ID修改反馈记录的处理状态")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> updateFeedbackStatus(
            @ApiParam(value = "反馈ID", example = "123", required = true)
            @PathVariable Long feedbackId,

            @ApiParam(value = "新的反馈状态", example = "已处理", required = true)
            @RequestParam String status) {
        feedbackService.updateFeedbackStatus(feedbackId, status);
        return ApiResponse.success(true);
    }

    /**
     * 获取反馈统计数据
     *
     * @return 统计结果，包含总反馈数、处理状态统计等信息
     */
    @GetMapping("/admin/stats")
    @ApiOperation(value = "管理员查看用户反馈统计数据", notes = "查看用户反馈的统计数据，包括总反馈数、各状态的统计数量等")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Object> getFeedbackStats() {
        return ApiResponse.success(feedbackService.getFeedbackStats());
    }

    /**
     * 分析用户反馈的情感分布
     *
     * @return 用户反馈的情感分析结果，包括正面、负面、中性的分布
     */
    @GetMapping("/admin/analyze-sentiment")
    @ApiOperation(value = "分析用户反馈情感分布", notes = "对用户反馈内容进行情感分析，统计正面、负面和中性反馈的数量")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<SentimentAnalysisResult> analyzeSentiment() {
        SentimentAnalysisResult sentimentStats = feedbackService.analyzeFeedbackSentiment();
        return ApiResponse.success(sentimentStats);
    }
}
