package com.foodrecord.model.dto;


public class NutritionDTO {
    private Long id;
    private Long foodId;
    private Float calory;
    private Float protein;
    private Float fat;
    private Float carbohydrate;
    private Float fiberDietary;
    private Float natrium;
    private Float calcium;
    private Float potassium;
    private Float iron;
    private Float selenium;

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

    public Float getCalory() {
        return calory;
    }

    public void setCalory(Float calory) {
        this.calory = calory;
    }

    public Float getProtein() {
        return protein;
    }

    public void setProtein(Float protein) {
        this.protein = protein;
    }

    public Float getFat() {
        return fat;
    }

    public void setFat(Float fat) {
        this.fat = fat;
    }

    public Float getCarbohydrate() {
        return carbohydrate;
    }

    public void setCarbohydrate(Float carbohydrate) {
        this.carbohydrate = carbohydrate;
    }

    public Float getFiberDietary() {
        return fiberDietary;
    }

    public void setFiberDietary(Float fiberDietary) {
        this.fiberDietary = fiberDietary;
    }

    public Float getNatrium() {
        return natrium;
    }

    public void setNatrium(Float natrium) {
        this.natrium = natrium;
    }

    public Float getCalcium() {
        return calcium;
    }

    public void setCalcium(Float calcium) {
        this.calcium = calcium;
    }

    public Float getPotassium() {
        return potassium;
    }

    public void setPotassium(Float potassium) {
        this.potassium = potassium;
    }

    public Float getIron() {
        return iron;
    }

    public void setIron(Float iron) {
        this.iron = iron;
    }

    public Float getSelenium() {
        return selenium;
    }

    public void setSelenium(Float selenium) {
        this.selenium = selenium;
    }
}