package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "食物排名实体")
@TableName("rankings")
public class Rankings extends BaseEntity {

    @ApiModelProperty(value = "排名ID", example = "1")
    @TableId(type = IdType.AUTO)
    private Long id;

    @ApiModelProperty(value = "食物ID", example = "20002")
    @TableField("food_id")
    private Long foodId;

    @ApiModelProperty(value = "排名类型（POPULAR: 热门, RATING: 评分, NUTRITION: 营养）", example = "POPULAR")
    @TableField("rank_type")
    private String rankType;

    @ApiModelProperty(value = "排名得分", example = "4.8")
    @TableField("rank_score")
    private Double rankScore;

    @ApiModelProperty(value = "排名位置", example = "1")
    @TableField("rank_position")
    private Integer rankPosition;

    @ApiModelProperty(value = "关联的食物实体")
    @TableField(exist = false)
    private Food food;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getFoodId() {
        return foodId;
    }

    public void setFoodId(Long foodId) {
        this.foodId = foodId;
    }

    public String getRankType() {
        return rankType;
    }

    public void setRankType(String rankType) {
        this.rankType = rankType;
    }

    public Double getRankScore() {
        return rankScore;
    }

    public void setRankScore(Double rankScore) {
        this.rankScore = rankScore;
    }

    public Integer getRankPosition() {
        return rankPosition;
    }

    public void setRankPosition(Integer rankPosition) {
        this.rankPosition = rankPosition;
    }

    public Food getFood() {
        return food;
    }

    public void setFood(Food food) {
        this.food = food;
    }
}