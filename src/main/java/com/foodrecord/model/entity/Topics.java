package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import javax.validation.constraints.NotNull;
import javax.validation.constraints.Size;
import java.io.Serializable;
import java.util.Date;

/**
 * 
 * @TableName topics
 */
@TableName(value ="topics")
public class Topics implements Serializable {
    /**
     * 话题表ID
     */
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    /**
     * 话题名
     */
    @TableField(value = "name")
    @NotNull(message = "话题名不能为空")
    @Size(min = 1, max = 100, message = "话题名长度必须在 1 到 100 之间")
    private String name;

    /**
     * 热度值
     */
    @TableField(value = "popularity")
    private Integer popularity;

    /**
     * 创建时间
     */
    @TableField(value = "created_at")
    private Date createdAt;

    /**
     * 是否删除后
     */
    @TableField(value = "is_delete")
    private Integer isDelete;

    @TableField(exist = false)
    private static final long serialVersionUID = 1L;

    /**
     * 话题表ID
     */
    public Long getId() {
        return id;
    }

    /**
     * 话题表ID
     */
    public void setId(Long id) {
        this.id = id;
    }

    /**
     * 话题名
     */
    public String getName() {
        return name;
    }

    /**
     * 话题名
     */
    public void setName(String name) {
        this.name = name;
    }

    /**
     * 热度值
     */
    public Integer getPopularity() {
        return popularity;
    }

    /**
     * 热度值
     */
    public void setPopularity(Integer popularity) {
        this.popularity = popularity;
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

    public Integer getIsDelete() {
        return isDelete;
    }

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
        Topics other = (Topics) that;
        return (this.getId() == null ? other.getId() == null : this.getId().equals(other.getId()))
            && (this.getName() == null ? other.getName() == null : this.getName().equals(other.getName()))
            && (this.getPopularity() == null ? other.getPopularity() == null : this.getPopularity().equals(other.getPopularity()))
            && (this.getCreatedAt() == null ? other.getCreatedAt() == null : this.getCreatedAt().equals(other.getCreatedAt()));
    }


    @Override
    public int hashCode() {
        final int prime = 31;
        int result = 1;
        result = prime * result + ((getId() == null) ? 0 : getId().hashCode());
        result = prime * result + ((getName() == null) ? 0 : getName().hashCode());
        result = prime * result + ((getPopularity() == null) ? 0 : getPopularity().hashCode());
        result = prime * result + ((getCreatedAt() == null) ? 0 : getCreatedAt().hashCode());
        return result;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder();
        sb.append(getClass().getSimpleName());
        sb.append(" [");
        sb.append("Hash = ").append(hashCode());
        sb.append(", id=").append(id);
        sb.append(", name=").append(name);
        sb.append(", popularity=").append(popularity);
        sb.append(", createdAt=").append(createdAt);
        sb.append(", serialVersionUID=").append(serialVersionUID);
        sb.append("]");
        return sb.toString();
    }
}