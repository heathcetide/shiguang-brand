package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import io.swagger.annotations.ApiModel;
import io.swagger.annotations.ApiModelProperty;

@ApiModel(description = "维生素信息实体")
@TableName("vitamins")
public class Vitamins {

    @ApiModelProperty(value = "维生素信息ID", example = "1")
    private Long id;

    @ApiModelProperty(value = "关联的食物实体")
    private Food food;

    @ApiModelProperty(value = "维生素A含量", example = "1.2")
    @TableField("vitamin_a")
    private Float vitaminA;

    @ApiModelProperty(value = "胡萝卜素含量", example = "0.8")
    private Float carotene;

    @ApiModelProperty(value = "维生素D含量", example = "0.5")
    @TableField("vitamin_d")
    private Float vitaminD;

    @ApiModelProperty(value = "维生素E含量", example = "0.3")
    @TableField("vitamin_e")
    private Float vitaminE;

    @ApiModelProperty(value = "硫胺素含量", example = "0.1")
    private Float thiamine;

    @ApiModelProperty(value = "核黄素含量", example = "0.07")
    private Float lactoflavin;

    @ApiModelProperty(value = "维生素C含量", example = "0.9")
    @TableField("vitamin_c")
    private Float vitaminC;

    @ApiModelProperty(value = "烟酸含量", example = "0.6")
    private Float niacin;

    @ApiModelProperty(value = "视黄醇含量", example = "0.2")
    private Float retinol;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Food getFood() {
        return food;
    }

    public void setFood(Food food) {
        this.food = food;
    }

    public Float getVitaminA() {
        return vitaminA;
    }

    public void setVitaminA(Float vitaminA) {
        this.vitaminA = vitaminA;
    }

    public Float getCarotene() {
        return carotene;
    }

    public void setCarotene(Float carotene) {
        this.carotene = carotene;
    }

    public Float getVitaminD() {
        return vitaminD;
    }

    public void setVitaminD(Float vitaminD) {
        this.vitaminD = vitaminD;
    }

    public Float getVitaminE() {
        return vitaminE;
    }

    public void setVitaminE(Float vitaminE) {
        this.vitaminE = vitaminE;
    }

    public Float getThiamine() {
        return thiamine;
    }

    public void setThiamine(Float thiamine) {
        this.thiamine = thiamine;
    }

    public Float getLactoflavin() {
        return lactoflavin;
    }

    public void setLactoflavin(Float lactoflavin) {
        this.lactoflavin = lactoflavin;
    }

    public Float getVitaminC() {
        return vitaminC;
    }

    public void setVitaminC(Float vitaminC) {
        this.vitaminC = vitaminC;
    }

    public Float getNiacin() {
        return niacin;
    }

    public void setNiacin(Float niacin) {
        this.niacin = niacin;
    }

    public Float getRetinol() {
        return retinol;
    }

    public void setRetinol(Float retinol) {
        this.retinol = retinol;
    }
}