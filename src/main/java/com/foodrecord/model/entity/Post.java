package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.io.Serializable;
import java.util.Date;

/**
 * 
 * @TableName post
 */
@TableName(value ="post")
public class Post implements Serializable {
    /**
     * 帖子ID
     */
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    /**
     * 用户ID
     */
    @TableField(value = "user_id")
    private Long userId;

    /**
     * 内容
     */
    @TableField(value = "content")
    private String content;

    /**
     * 媒体URL
     */
    @TableField(value = "media_url")
    private String mediaUrl;

    /**
     * 标签（JSON数组格式）
     */
    @TableField(value = "tags")
    private String tags;

    /**
     * 点赞数
     */
    @TableField(value = "likes_count")
    private Integer likesCount;

    /**
     * 评论数
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
     * 帖子ID
     */
    public Long getId() {
        return id;
    }

    /**
     * 帖子ID
     */
    public void setId(Long id) {
        this.id = id;
    }

    /**
     * 用户ID
     */
    public Long getUserId() {
        return userId;
    }

    /**
     * 用户ID
     */
    public void setUserId(Long userId) {
        this.userId = userId;
    }

    /**
     * 内容
     */
    public String getContent() {
        return content;
    }

    /**
     * 内容
     */
    public void setContent(String content) {
        this.content = content;
    }

    /**
     * 媒体URL
     */
    public String getMediaUrl() {
        return mediaUrl;
    }

    /**
     * 媒体URL
     */
    public void setMediaUrl(String mediaUrl) {
        this.mediaUrl = mediaUrl;
    }

    /**
     * 标签（JSON数组格式）
     */
    public String getTags() {
        return tags;
    }

    /**
     * 标签（JSON数组格式）
     */
    public void setTags(String tags) {
        this.tags = tags;
    }

    /**
     * 点赞数
     */
    public Integer getLikesCount() {
        return likesCount;
    }

    /**
     * 点赞数
     */
    public void setLikesCount(Integer likesCount) {
        this.likesCount = likesCount;
    }

    /**
     * 评论数
     */
    public Integer getCommentsCount() {
        return commentsCount;
    }

    /**
     * 评论数
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
        Post other = (Post) that;
        return (this.getId() == null ? other.getId() == null : this.getId().equals(other.getId()))
            && (this.getUserId() == null ? other.getUserId() == null : this.getUserId().equals(other.getUserId()))
            && (this.getContent() == null ? other.getContent() == null : this.getContent().equals(other.getContent()))
            && (this.getMediaUrl() == null ? other.getMediaUrl() == null : this.getMediaUrl().equals(other.getMediaUrl()))
            && (this.getTags() == null ? other.getTags() == null : this.getTags().equals(other.getTags()))
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
        result = prime * result + ((getContent() == null) ? 0 : getContent().hashCode());
        result = prime * result + ((getMediaUrl() == null) ? 0 : getMediaUrl().hashCode());
        result = prime * result + ((getTags() == null) ? 0 : getTags().hashCode());
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
        sb.append(", content=").append(content);
        sb.append(", mediaUrl=").append(mediaUrl);
        sb.append(", tags=").append(tags);
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