package com.foodrecord.model.entity.video;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.io.Serializable;
import java.util.Date;

/**
 * 用户观看历史表
 * @TableName watch_history
 */
@TableName(value ="watch_history")
public class WatchHistory implements Serializable {
    /**
     * 历史记录ID
     */
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    /**
     * 用户ID
     */
    @TableField(value = "user_id")
    private Long userId;

    /**
     * 视频ID
     */
    @TableField(value = "video_id")
    private Long videoId;

    /**
     * 观看时间
     */
    @TableField(value = "watched_at")
    private Date watchedAt;

    @TableField(exist = false)
    private static final long serialVersionUID = 1L;

    /**
     * 历史记录ID
     */
    public Long getId() {
        return id;
    }

    /**
     * 历史记录ID
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
     * 视频ID
     */
    public Long getVideoId() {
        return videoId;
    }

    /**
     * 视频ID
     */
    public void setVideoId(Long videoId) {
        this.videoId = videoId;
    }

    /**
     * 观看时间
     */
    public Date getWatchedAt() {
        return watchedAt;
    }

    /**
     * 观看时间
     */
    public void setWatchedAt(Date watchedAt) {
        this.watchedAt = watchedAt;
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
        WatchHistory other = (WatchHistory) that;
        return (this.getId() == null ? other.getId() == null : this.getId().equals(other.getId()))
            && (this.getUserId() == null ? other.getUserId() == null : this.getUserId().equals(other.getUserId()))
            && (this.getVideoId() == null ? other.getVideoId() == null : this.getVideoId().equals(other.getVideoId()))
            && (this.getWatchedAt() == null ? other.getWatchedAt() == null : this.getWatchedAt().equals(other.getWatchedAt()));
    }

    @Override
    public int hashCode() {
        final int prime = 31;
        int result = 1;
        result = prime * result + ((getId() == null) ? 0 : getId().hashCode());
        result = prime * result + ((getUserId() == null) ? 0 : getUserId().hashCode());
        result = prime * result + ((getVideoId() == null) ? 0 : getVideoId().hashCode());
        result = prime * result + ((getWatchedAt() == null) ? 0 : getWatchedAt().hashCode());
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
        sb.append(", videoId=").append(videoId);
        sb.append(", watchedAt=").append(watchedAt);
        sb.append(", serialVersionUID=").append(serialVersionUID);
        sb.append("]");
        return sb.toString();
    }
}