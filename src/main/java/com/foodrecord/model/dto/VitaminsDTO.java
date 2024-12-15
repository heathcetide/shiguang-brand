package com.foodrecord.model.dto;

public class VitaminsDTO {
    private Long id;
    private Long foodId;
    private Float vitaminA;
    private Float carotene;
    private Float vitaminD;
    private Float vitaminE;
    private Float thiamine;
    private Float lactoflavin;
    private Float vitaminC;
    private Float niacin;
    private Float retinol;

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