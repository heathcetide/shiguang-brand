package com.foodrecord.model.vo;

import java.time.LocalDateTime;
import java.util.List;

public class PostSearchVO {
    
    /**
     * 关键词
     */
    private String keyword;
    
    /**
     * 标签列表
     */
    private List<String> tags;
    
    /**
     * 用户ID
     */
    private Long userId;
    
    /**
     * 开始时间
     */
    private LocalDateTime startTime;
    
    /**
     * 结束时间
     */
    private LocalDateTime endTime;
    
    /**
     * 最小点赞数
     */
    private Integer minLikes;
    
    /**
     * 最小评论数
     */
    private Integer minComments;
    
    /**
     * 排序字段
     */
    private String sortField;
    
    /**
     * 排序方向：asc/desc
     */
    private String sortOrder;
    
    /**
     * 是否只看置顶
     */
    private Boolean onlyPinned;

    public String getKeyword() {
        return keyword;
    }

    public void setKeyword(String keyword) {
        this.keyword = keyword;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public LocalDateTime getStartTime() {
        return startTime;
    }

    public void setStartTime(LocalDateTime startTime) {
        this.startTime = startTime;
    }

    public LocalDateTime getEndTime() {
        return endTime;
    }

    public void setEndTime(LocalDateTime endTime) {
        this.endTime = endTime;
    }

    public Integer getMinLikes() {
        return minLikes;
    }

    public void setMinLikes(Integer minLikes) {
        this.minLikes = minLikes;
    }

    public Integer getMinComments() {
        return minComments;
    }

    public void setMinComments(Integer minComments) {
        this.minComments = minComments;
    }

    public String getSortField() {
        return sortField;
    }

    public void setSortField(String sortField) {
        this.sortField = sortField;
    }

    public String getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(String sortOrder) {
        this.sortOrder = sortOrder;
    }

    public Boolean getOnlyPinned() {
        return onlyPinned;
    }

    public void setOnlyPinned(Boolean onlyPinned) {
        this.onlyPinned = onlyPinned;
    }
}