package com.foodrecord.model.dto;

import javax.validation.constraints.*;

public class RankingsDTO {
    private Long id;
    
    @NotNull(message = "食物ID不能为空")
    private Long foodId;
    
    @NotBlank(message = "排名类型不能为空")
    private String rankType;
    
    @NotNull(message = "排名分数不能为空")
    @PositiveOrZero(message = "排名分数必须大于等于0")
    private Double rankScore;
    
    @NotNull(message = "排名位置不能为空")
    @Positive(message = "排名位置必须大于0")
    private Integer rankPosition;

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

    public @NotBlank(message = "排名类型不能为空") String getRankType() {
        return rankType;
    }

    public void setRankType(@NotBlank(message = "排名类型不能为空") String rankType) {
        this.rankType = rankType;
    }

    public @NotNull(message = "排名分数不能为空") @PositiveOrZero(message = "排名分数必须大于等于0") Double getRankScore() {
        return rankScore;
    }

    public void setRankScore(@NotNull(message = "排名分数不能为空") @PositiveOrZero(message = "排名分数必须大于等于0") Double rankScore) {
        this.rankScore = rankScore;
    }

    public @NotNull(message = "排名位置不能为空") @Positive(message = "排名位置必须大于0") Integer getRankPosition() {
        return rankPosition;
    }

    public void setRankPosition(@NotNull(message = "排名位置不能为空") @Positive(message = "排名位置必须大于0") Integer rankPosition) {
        this.rankPosition = rankPosition;
    }
}