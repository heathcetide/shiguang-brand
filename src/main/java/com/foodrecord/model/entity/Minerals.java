package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.*;


@TableName("minerals")
public class Minerals extends BaseEntity {
    @TableId(type = IdType.AUTO)
    private Long id;
    
    @TableField("food_id")
    private Long foodId;
    
    @TableField("phosphor")
    private Float phosphor;
    
    @TableField("kalium")
    private Float kalium;
    
    @TableField("magnesium")
    private Float magnesium;
    
    @TableField("calcium")
    private Float calcium;
    
    @TableField("iron")
    private Float iron;
    
    @TableField("zinc")
    private Float zinc;
    
    @TableField("iodine")
    private Float iodine;
    
    @TableField("selenium")
    private Float selenium;
    
    @TableField("copper")
    private Float copper;
    
    @TableField("fluorine")
    private Float fluorine;
    
    @TableField("manganese")
    private Float manganese;
    
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

    public Float getPhosphor() {
        return phosphor;
    }

    public void setPhosphor(Float phosphor) {
        this.phosphor = phosphor;
    }

    public Float getKalium() {
        return kalium;
    }

    public void setKalium(Float kalium) {
        this.kalium = kalium;
    }

    public Float getMagnesium() {
        return magnesium;
    }

    public void setMagnesium(Float magnesium) {
        this.magnesium = magnesium;
    }

    public Float getCalcium() {
        return calcium;
    }

    public void setCalcium(Float calcium) {
        this.calcium = calcium;
    }

    public Float getIron() {
        return iron;
    }

    public void setIron(Float iron) {
        this.iron = iron;
    }

    public Float getZinc() {
        return zinc;
    }

    public void setZinc(Float zinc) {
        this.zinc = zinc;
    }

    public Float getIodine() {
        return iodine;
    }

    public void setIodine(Float iodine) {
        this.iodine = iodine;
    }

    public Float getSelenium() {
        return selenium;
    }

    public void setSelenium(Float selenium) {
        this.selenium = selenium;
    }

    public Float getCopper() {
        return copper;
    }

    public void setCopper(Float copper) {
        this.copper = copper;
    }

    public Float getFluorine() {
        return fluorine;
    }

    public void setFluorine(Float fluorine) {
        this.fluorine = fluorine;
    }

    public Float getManganese() {
        return manganese;
    }

    public void setManganese(Float manganese) {
        this.manganese = manganese;
    }

    public Food getFood() {
        return food;
    }

    public void setFood(Food food) {
        this.food = food;
    }
}