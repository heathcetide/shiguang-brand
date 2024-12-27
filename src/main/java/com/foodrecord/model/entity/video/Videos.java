package com.foodrecord.model.entity.video;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.io.Serializable;
import java.util.Date;

/**
 * 短视频表
 * @TableName videos
 */
@TableName(value ="videos")
public class Videos implements Serializable {
    /**
     * 视频ID
     */
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    /**
     * 用户ID，发布者
     */
    @TableField(value = "user_id")
    private Long userId;

    /**
     * 视频标题
     */
    @TableField(value = "title")
    private String title;

    /**
     * 视频描述
     */
    @TableField(value = "description")
    private String description;

    /**
     * 视频存储的URL
     */
    @TableField(value = "video_url")
    private String videoUrl;

    /**
     * 视频封面图URL
     */
    @TableField(value = "thumbnail_url")
    private String thumbnailUrl;

    /**
     * 视频时长（秒）
     */
    @TableField(value = "duration")
    private Integer duration;

    /**
     * 观看次数
     */
    @TableField(value = "views_count")
    private Integer viewsCount;

    /**
     * 点赞次数
     */
    @TableField(value = "likes_count")
    private Integer likesCount;

    /**
     * 评论次数
     */
    @TableField(value = "comments_count")
    private Integer commentsCount;

    /**
     * 创建时间
     */
    @TableField(value = "created_at")
    private Date createdAt;

    /**
     * 更新时间
     */
    @TableField(value = "updated_at")
    private Date updatedAt;

    /**
     * 是否删除（0=否，1=是）
     */
    @TableField(value = "is_delete")
    private Integer isDelete;

    @TableField(exist = false)
    private static final long serialVersionUID = 1L;

    /**
     * 视频ID
     */
    public Long getId() {
        return id;
    }

    /**
     * 视频ID
     */
    public void setId(Long id) {
        this.id = id;
    }

    /**
     * 用户ID，发布者
     */
    public Long getUserId() {
        return userId;
    }

    /**
     * 用户ID，发布者
     */
    public void setUserId(Long userId) {
        this.userId = userId;
    }

    /**
     * 视频标题
     */
    public String getTitle() {
        return title;
    }

    /**
     * 视频标题
     */
    public void setTitle(String title) {
        this.title = title;
    }

    /**
     * 视频描述
     */
    public String getDescription() {
        return description;
    }

    /**
     * 视频描述
     */
    public void setDescription(String description) {
        this.description = description;
    }

    /**
     * 视频存储的URL
     */
    public String getVideoUrl() {
        return videoUrl;
    }

    /**
     * 视频存储的URL
     */
    public void setVideoUrl(String videoUrl) {
        this.videoUrl = videoUrl;
    }

    /**
     * 视频封面图URL
     */
    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    /**
     * 视频封面图URL
     */
    public void setThumbnailUrl(String thumbnailUrl) {
        this.thumbnailUrl = thumbnailUrl;
    }

    /**
     * 视频时长（秒）
     */
    public Integer getDuration() {
        return duration;
    }

    /**
     * 视频时长（秒）
     */
    public void setDuration(Integer duration) {
        this.duration = duration;
    }

    /**
     * 观看次数
     */
    public Integer getViewsCount() {
        return viewsCount;
    }

    /**
     * 观看次数
     */
    public void setViewsCount(Integer viewsCount) {
        this.viewsCount = viewsCount;
    }

    /**
     * 点赞次数
     */
    public Integer getLikesCount() {
        return likesCount;
    }

    /**
     * 点赞次数
     */
    public void setLikesCount(Integer likesCount) {
        this.likesCount = likesCount;
    }

    /**
     * 评论次数
     */
    public Integer getCommentsCount() {
        return commentsCount;
    }

    /**
     * 评论次数
     */
    public void setCommentsCount(Integer commentsCount) {
        this.commentsCount = commentsCount;
    }

    /**
     * 创建时间
     */
    public Date getCreatedAt() {
        return createdAt;
    }

    /**
     * 创建时间
     */
    public void setCreatedAt(Date createdAt) {
        this.createdAt = createdAt;
    }

    /**
     * 更新时间
     */
    public Date getUpdatedAt() {
        return updatedAt;
    }

    /**
     * 更新时间
     */
    public void setUpdatedAt(Date updatedAt) {
        this.updatedAt = updatedAt;
    }

    /**
     * 是否删除（0=否，1=是）
     */
    public Integer getIsDelete() {
        return isDelete;
    }

    /**
     * 是否删除（0=否，1=是）
     */
    public void setIsDelete(Integer isDelete) {
        this.isDelete = isDelete;
    }

    @Override
    public boolean equals(Object that) {
        if (this == that) {
            return true;
        }
        if (that == null) {
            return false;
        }
        if (getClass() != that.getClass()) {
            return false;
        }
        Videos other = (Videos) that;
        return (this.getId() == null ? other.getId() == null : this.getId().equals(other.getId()))
            && (this.getUserId() == null ? other.getUserId() == null : this.getUserId().equals(other.getUserId()))
            && (this.getTitle() == null ? other.getTitle() == null : this.getTitle().equals(other.getTitle()))
            && (this.getDescription() == null ? other.getDescription() == null : this.getDescription().equals(other.getDescription()))
            && (this.getVideoUrl() == null ? other.getVideoUrl() == null : this.getVideoUrl().equals(other.getVideoUrl()))
            && (this.getThumbnailUrl() == null ? other.getThumbnailUrl() == null : this.getThumbnailUrl().equals(other.getThumbnailUrl()))
            && (this.getDuration() == null ? other.getDuration() == null : this.getDuration().equals(other.getDuration()))
            && (this.getViewsCount() == null ? other.getViewsCount() == null : this.getViewsCount().equals(other.getViewsCount()))
            && (this.getLikesCount() == null ? other.getLikesCount() == null : this.getLikesCount().equals(other.getLikesCount()))
            && (this.getCommentsCount() == null ? other.getCommentsCount() == null : this.getCommentsCount().equals(other.getCommentsCount()))
            && (this.getCreatedAt() == null ? other.getCreatedAt() == null : this.getCreatedAt().equals(other.getCreatedAt()))
            && (this.getUpdatedAt() == null ? other.getUpdatedAt() == null : this.getUpdatedAt().equals(other.getUpdatedAt()))
            && (this.getIsDelete() == null ? other.getIsDelete() == null : this.getIsDelete().equals(other.getIsDelete()));
    }

    @Override
    public int hashCode() {
        final int prime = 31;
        int result = 1;
        result = prime * result + ((getId() == null) ? 0 : getId().hashCode());
        result = prime * result + ((getUserId() == null) ? 0 : getUserId().hashCode());
        result = prime * result + ((getTitle() == null) ? 0 : getTitle().hashCode());
        result = prime * result + ((getDescription() == null) ? 0 : getDescription().hashCode());
        result = prime * result + ((getVideoUrl() == null) ? 0 : getVideoUrl().hashCode());
        result = prime * result + ((getThumbnailUrl() == null) ? 0 : getThumbnailUrl().hashCode());
        result = prime * result + ((getDuration() == null) ? 0 : getDuration().hashCode());
        result = prime * result + ((getViewsCount() == null) ? 0 : getViewsCount().hashCode());
        result = prime * result + ((getLikesCount() == null) ? 0 : getLikesCount().hashCode());
        result = prime * result + ((getCommentsCount() == null) ? 0 : getCommentsCount().hashCode());
        result = prime * result + ((getCreatedAt() == null) ? 0 : getCreatedAt().hashCode());
        result = prime * result + ((getUpdatedAt() == null) ? 0 : getUpdatedAt().hashCode());
        result = prime * result + ((getIsDelete() == null) ? 0 : getIsDelete().hashCode());
        return result;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder();
        sb.append(getClass().getSimpleName());
        sb.append(" [");
        sb.append("Hash = ").append(hashCode());
        sb.append(", id=").append(id);
        sb.append(", userId=").append(userId);
        sb.append(", title=").append(title);
        sb.append(", description=").append(description);
        sb.append(", videoUrl=").append(videoUrl);
        sb.append(", thumbnailUrl=").append(thumbnailUrl);
        sb.append(", duration=").append(duration);
        sb.append(", viewsCount=").append(viewsCount);
        sb.append(", likesCount=").append(likesCount);
        sb.append(", commentsCount=").append(commentsCount);
        sb.append(", createdAt=").append(createdAt);
        sb.append(", updatedAt=").append(updatedAt);
        sb.append(", isDelete=").append(isDelete);
        sb.append(", serialVersionUID=").append(serialVersionUID);
        sb.append("]");
        return sb.toString();
    }
}