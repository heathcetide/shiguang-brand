package com.foodrecord.model.dto;

import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

public class SceneDTO {
    private Long id;
    
    @NotNull(message = "食物ID不能为空")
    private Long foodId;
    
    @NotBlank(message = "场景不能为空")
    private String scene;
    
    private Boolean suitable;
    private String[] tags;
    private String name;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public @NotNull(message = "食物ID不能为空") Long getFoodId() {
        return foodId;
    }

    public void setFoodId(@NotNull(message = "食物ID不能为空") Long foodId) {
        this.foodId = foodId;
    }

    public @NotBlank(message = "场景不能为空") String getScene() {
        return scene;
    }

    public void setScene(@NotBlank(message = "场景不能为空") String scene) {
        this.scene = scene;
    }

    public Boolean getSuitable() {
        return suitable;
    }

    public void setSuitable(Boolean suitable) {
        this.suitable = suitable;
    }

    public String[] getTags() {
        return tags;
    }

    public void setTags(String[] tags) {
        this.tags = tags;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}