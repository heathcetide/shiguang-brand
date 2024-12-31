package com.foodrecord.core.db.routing.query;

public enum DataAccessPattern {
    POINT_SELECT,
    RANGE_SCAN,
    FULL_SCAN,
    AGGREGATION,
    JOIN
}
