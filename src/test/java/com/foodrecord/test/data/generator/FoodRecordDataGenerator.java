package com.foodrecord.test.data.generator;//package com.foodrecord.test.data.generator;
//
//import org.springframework.stereotype.Component;
//import lombok.extern.slf4j.Slf4j;
//import com.github.javafaker.Faker;
//import java.time.LocalDateTime;
//
//@Slf4j
//@Component
//public class FoodRecordDataGenerator {
//    private final Faker faker = new Faker();
//
//    public FoodRecord generateFoodRecord() {
//        return FoodRecord.builder()
//            .userId(generateUserId())
//            .foodName(generateFoodName())
//            .calories(generateCalories())
//            .nutrients(generateNutrients())
//            .consumptionTime(generateConsumptionTime())
//            .location(generateLocation())
//            .tags(generateTags())
//            .build();
//    }
//
//    public List<FoodRecord> generateBatchRecords(int count) {
//        return IntStream.range(0, count)
//            .mapToObj(i -> generateFoodRecord())
//            .collect(Collectors.toList());
//    }
//
//    private Nutrients generateNutrients() {
//        return Nutrients.builder()
//            .protein(faker.number().randomDouble(2, 0, 100))
//            .carbohydrates(faker.number().randomDouble(2, 0, 300))
//            .fat(faker.number().randomDouble(2, 0, 100))
//            .fiber(faker.number().randomDouble(2, 0, 50))
//            .vitamins(generateVitamins())
//            .minerals(generateMinerals())
//            .build();
//    }
//
//    private Location generateLocation() {
//        return Location.builder()
//            .latitude(faker.address().latitude())
//            .longitude(faker.address().longitude())
//            .name(faker.company().name())
//            .type(faker.options().option(LocationType.class))
//            .build();
//    }
//
//    @Data
//    @Builder
//    public static class TestDataMetrics {
//        private final int totalRecords;
//        private final Map<String, Integer> recordDistribution;
//        private final DataQualityMetrics qualityMetrics;
//        private final Map<String, Double> averageValues;
//    }
//}