package com.foodrecord.model.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;


@TableName("vitamins")
public class Vitamins {

    private Long id;
    private Food food;
    
    @TableField("vitamin_a")
    private Float vitaminA;
    
    private Float carotene;
    
    @TableField("vitamin_d")
    private Float vitaminD;
    
    @TableField("vitamin_e")
    private Float vitaminE;
    
    private Float thiamine;
    private Float lactoflavin;
    
    @TableField("vitamin_c")
    private Float vitaminC;
    
    private Float niacin;
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