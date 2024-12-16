package com.foodrecord.model.dto;

public class FeedbackQueryDTO {
    private Long userId;       // 用户 ID
    private Long foodId;       // 食物 ID
    private Integer minRating; // 最低评分
    private Integer maxRating; // 最高评分
    private String status;     // 状态（待处理、已处理等）
    private int page = 1;      // 分页页码
    private int size = 10;     // 每页大小

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getFoodId() {
        return foodId;
    }

    public void setFoodId(Long foodId) {
        this.foodId = foodId;
    }

    public Integer getMinRating() {
        return minRating;
    }

    public void setMinRating(Integer minRating) {
        this.minRating = minRating;
    }

    public Integer getMaxRating() {
        return maxRating;
    }

    public void setMaxRating(Integer maxRating) {
        this.maxRating = maxRating;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public int getPage() {
        return page;
    }

    public void setPage(int page) {
        this.page = page;
    }

    public int getSize() {
        return size;
    }

    public void setSize(int size) {
        this.size = size;
    }
}
