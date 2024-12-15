package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;


@TableName("rankings")
public class Rankings extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("food_id")
    private Long foodId;
    
    @TableField("rank_type")
    private String rankType;  // POPULAR(热门), RATING(评分), NUTRITION(营养)
    
    @TableField("rank_score")
    private Double rankScore;
    
    @TableField("rank_position")
    private Integer rankPosition;
    
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