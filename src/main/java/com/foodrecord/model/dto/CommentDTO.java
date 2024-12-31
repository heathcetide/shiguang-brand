package com.foodrecord.model.dto;


import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel("评论DTO")
public class CommentDTO {
    @ApiModelProperty("评论内容")
    private String content;

    @ApiModelProperty("父评论ID（回复评论时使用）")
    private Long parentId;

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public Long getParentId() {
        return parentId;
    }

    public void setParentId(Long parentId) {
        this.parentId = parentId;
    }
}