package com.foodrecord.model.entity.video;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import java.io.Serializable;
import java.util.Date;

@ApiModel(description = "视频水印配置实体")
@TableName("video_watermarks")
public class VideoWatermark implements Serializable {

    private static final long serialVersionUID = 1L;

    @ApiModelProperty(value = "配置ID")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "视频ID")
    private Long videoId;

    @ApiModelProperty(value = "水印类型(text/image)")
    private String type;

    @ApiModelProperty(value = "水印内容")
    private String content;

    @ApiModelProperty(value = "水印位置(topLeft/topRight/bottomLeft/bottomRight/center)")
    private String position;

    @ApiModelProperty(value = "水印大小")
    private Integer size;

    @ApiModelProperty(value = "水印透明度(0-1)")
    private Float opacity;

    @ApiModelProperty(value = "创建时间")
    private Date createdAt;

    @ApiModelProperty(value = "更新时间")
    private Date updatedAt;

    // Getters and Setters
    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getVideoId() {
        return videoId;
    }

    public void setVideoId(Long videoId) {
        this.videoId = videoId;
    }

    public String getWatermarkType() {
        return type;
    }

    public void setWatermarkType(String watermarkType) {
        this.type = watermarkType;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getPosition() {
        return position;
    }

    public void setPosition(String position) {
        this.position = position;
    }

    public Float getOpacity() {
        return opacity;
    }

    public void setOpacity(Float opacity) {
        this.opacity = opacity;
    }

    public Integer getSize() {
        return size;
    }

    public void setSize(Integer size) {
        this.size = size;
    }

    public Date getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Date createdAt) {
        this.createdAt = createdAt;
    }

    public Date getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Date updatedAt) {
        this.updatedAt = updatedAt;
    }
} 