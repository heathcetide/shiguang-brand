package com.foodrecord.model.dto;


import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

import java.util.List;

@ApiModel("帖子DTO")
public class PostDTO {
    @ApiModelProperty("帖子内容")
    private String content;

    @ApiModelProperty("媒体URL")
    private String mediaUrl;

    @ApiModelProperty("标签列表")
    private List<String> tags;

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getMediaUrl() {
        return mediaUrl;
    }

    public void setMediaUrl(String mediaUrl) {
        this.mediaUrl = mediaUrl;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }
}