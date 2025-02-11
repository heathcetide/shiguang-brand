package com.foodrecord.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.dto.FeedbackQueryDTO;
import com.foodrecord.model.dto.UserFeedbackDTO;
import com.foodrecord.model.entity.UserFeedback;
import com.foodrecord.model.vo.SentimentAnalysisResult;

import java.util.List;
import java.util.Map;

public interface UserFeedbackService extends IService<UserFeedback> {

    IPage<UserFeedback> getPageByFoodId(Long foodId, int page, int size);

    List<UserFeedback> getByFoodId(Long foodId);

    List<UserFeedback> getByUserId(Long userId);

    Double getAvgRatingByFoodId(Long foodId);

    UserFeedback createFeedback(Long userId, UserFeedbackDTO dto);

    UserFeedback updateFeedback(Long userId, Long feedbackId, UserFeedbackDTO dto);

    void deleteFeedback(Long userId, Long feedbackId);

    void deleteFeedbackById(Long feedbackId);
    /**
     * 管理员分页获取所有反馈记录。
     *
     * @param page 页码
     * @param size 每页大小
     * @return 分页反馈记录
     */
    IPage<UserFeedback> getAllFeedbacks(int page, int size);

    /**
     * 管理员批量删除反馈记录。
     *
     * @param feedbackIds 要删除的反馈记录 ID 列表
     */
    void deleteFeedbacksBatch(List<Long> feedbackIds);

    /**
     * 高级查询用户反馈记录。
     *
     * @param queryDTO 查询条件
     * @return 符合条件的分页反馈记录
     */
    IPage<UserFeedback> queryFeedbacks(FeedbackQueryDTO queryDTO);

    /**
     * 修改反馈状态。
     *
     * @param feedbackId 反馈记录 ID
     * @param status     新状态
     */
    void updateFeedbackStatus(Long feedbackId, String status);

    /**
     * 获取反馈统计信息。
     *
     * @return 统计数据
     */
    Map<String, Object> getFeedbackStats();

    SentimentAnalysisResult analyzeFeedbackSentiment();

    Page<UserFeedback> getFeedbacks(Page<UserFeedback> objectPage, String keyword);
}
