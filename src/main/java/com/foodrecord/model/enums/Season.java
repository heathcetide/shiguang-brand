package com.foodrecord.model.enums;

import java.time.Month;

/**
 * 季节枚举
 */
public enum Season {
    SPRING,
    SUMMER,
    AUTUMN,
    WINTER;
    
    /**
     * 根据月份获取季节
     */
    public static Season fromMonth(Month month) {
        switch (month) {
            case MARCH:
            case APRIL:
            case MAY:
                return SPRING;
            case JUNE:
            case JULY:
            case AUGUST:
                return SUMMER;
            case SEPTEMBER:
            case OCTOBER:
            case NOVEMBER:
                return AUTUMN;
            case DECEMBER:
            case JANUARY:
            case FEBRUARY:
                return WINTER;
            default:
                throw new IllegalArgumentException("Invalid month: " + month);
        }
    }
} 