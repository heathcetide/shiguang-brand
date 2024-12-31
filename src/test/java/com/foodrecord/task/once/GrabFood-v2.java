package com.foodrecord.task.once;//package com.foodrecord.task.once;
//
//import cn.hutool.core.lang.UUID;
//import cn.hutool.http.HttpRequest;
//import cn.hutool.json.JSONArray;
//import cn.hutool.json.JSONObject;
//import com.fasterxml.jackson.core.type.TypeReference;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import com.foodrecord.mapper.*;
//import com.foodrecord.model.entity.*;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.stereotype.Component;
//import org.springframework.transaction.annotation.Transactional;
//
//import javax.annotation.PostConstruct;
//import java.io.*;
//import java.util.ArrayList;
//import java.util.List;
//import java.util.Map;
//import java.util.concurrent.CopyOnWriteArrayList;
//import java.util.concurrent.ExecutorService;
//import java.util.concurrent.Executors;
//import java.util.concurrent.Future;
//
//@Component
//public class GrabFood {
//
//    private static final ObjectMapper objectMapper = new ObjectMapper();
//
//    private static final int BATCH_SIZE = 200; // 每批插入的数据量
//
//    private final List<Food> foodList = new CopyOnWriteArrayList<>();
//    private final List<GlycemicIndex> glycemicIndexList = new CopyOnWriteArrayList<>();
//    private final List<Minerals> mineralsList = new CopyOnWriteArrayList<>();
//    private final List<Nutrition> nutritionList = new CopyOnWriteArrayList<>();
//    private final List<Vitamins> vitaminsList = new CopyOnWriteArrayList<>();
////    private final List<Food> foodList = new ArrayList<>();
////    private final List<GlycemicIndex> glycemicIndexList = new ArrayList<>();
////    private final List<Minerals> mineralsList = new ArrayList<>();
////    private final List<Nutrition> nutritionList = new ArrayList<>();
////    private final List<Vitamins> vitaminsList = new ArrayList<>();
//
//    @Autowired
//    private FoodMapper foodMapper;
//
//    @Autowired
//    private VitaminsMapper vitaminsMapper;
//
//    @Autowired
//    private NutritionMapper nutritionMapper;
//
//    @Autowired
//    private GlycemicIndexMapper glycemicIndexMapper;
//
//    @Autowired
//    private MineralsMapper mineralsMapper;
//
//    private static final int THREAD_POOL_SIZE = 20; // 线程池大小
//    private final ExecutorService executorService = Executors.newFixedThreadPool(THREAD_POOL_SIZE);
//
//
//    @PostConstruct
//    public void executeTask() throws IOException {
//        List<String> codes = fetchCodes(); // 获取所有的 `code`
//
//        List<Future<?>> futures = new ArrayList<>();
//
//        // 多线程处理每个 `code`
//        for (String code : codes) {
//            futures.add(executorService.submit(() -> processCode(code)));
//        }
//
//        // 等待所有任务完成
//        for (Future<?> future : futures) {
//            try {
//                future.get(); // 等待任务完成
//            } catch (Exception e) {
//                e.printStackTrace();
//            }
//        }
//
//        // 插入剩余的数据
//        batchInsert();
//
//        // 关闭线程池
//        executorService.shutdown();
//    }
//
//    private void processCode(String code) {
//        try {
//            String url = "https://food.boohee.com//fb/v2/foods/" + code + "/detail?token=NatakoYQ6we4cdchwuUzCyGT3gDHm9aB";
//            String result = HttpRequest.get(url)
//                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36")
//                    .header("Referer", "https://food.boohee.com")
//                    .header("Accept-Language", "en-US,en;q=0.9")
//                    .execute()
//                    .body();
//
//            if (result == null || result.trim().isEmpty() || result.equals("{}")) {
//                System.out.println("获取到的结果为空，跳过 code: " + code);
//                return; // 跳过
//            }
//
//            Map<String, Object> response = objectMapper.readValue(result, new TypeReference<>() {
//            });
//            mapResponseToEntities(response);
//
//            synchronized (this) {
//                if (foodList.size() >= BATCH_SIZE) {
//                    batchInsert(); // 达到批量大小，插入数据库
//                }
//            }
//
//            Thread.sleep(300); // 防止请求过于频繁
//        } catch (Exception e) {
//            System.err.println("处理 code 出现异常: " + code);
//            e.printStackTrace();
//        }
//    }
//
//    private List<String> fetchCodes() throws IOException {
//        // 疾病类型
//        String[] diseases = {"减肥", "健身", "糖尿病", "高血压", "血脂异常", "痛风", "备孕", "孕期", "哺乳期",
//                "睡眠问题", "精力提升", "儿童长高", "肠道健康", "护发", "抗衰"};
//        // 分类 0-6
//        int[] categories = {0, 1, 2, 3, 4, 5, 6};
//        // 颜色 0 或 1
//        int[] colors = {0, 1};
//
//        List<String> codes = new ArrayList<>();
//
//        for (String disease : diseases) {
//            List<String> diseaseCodes = new ArrayList<>(); // 每种疾病的 code 列表
//            for (int category : categories) {
//                for (int color : colors) {
//                    String url = "https://seafarer.boohee.com/api/v1/red_black_foods?disease="
//                            + disease + "&color=" + color + "&category=" + category
//                            + "&token=NatakoYQ6we4cdchwuUzCyGT3gDHm9aB";
//                    try {
//                        // 发送请求并获取响应
//                        String response = HttpRequest.get(url).execute().body();
//                        JSONObject responseObject = new JSONObject(response);
//                        JSONArray foodsArray = responseObject.getJSONArray("foods");
//
//                        // 如果 foods 数据为空，则跳过
//                        if (foodsArray == null || foodsArray.isEmpty()) {
//                            continue;
//                        }
//
//                        // 解析数据并提取代码
//                        for (Object food : foodsArray) {
//                            JSONObject foodObject = (JSONObject) food;
//                            codes.add(foodObject.getStr("code"));
//                            diseaseCodes.add(foodObject.getStr("code"));
//                        }
//
//                    } catch (Exception e) {
//                        // 捕获异常，避免中断
//                        System.err.println("Error fetching data for: " +
//                                "disease=" + disease + ", category=" + category + ", color=" + color);
//                        e.printStackTrace();
//                    }
//                }
//            }
//            // 保存该疾病的 codes 到 JSON 文件
//            saveCodesToFileForDisease(disease, diseaseCodes);
//        }
//        // 保存数据到文件
//        saveCodesToFile(codes);
//        return codes;
//    }
//
//
//    /**
//     * 保存每种疾病的 codes 到 JSON 文件
//     *
//     * @param disease 疾病名称
//     * @param codes   代码列表
//     * @throws IOException 如果发生文件写入错误
//     */
//    private void saveCodesToFileForDisease(String disease, List<String> codes) throws IOException {
//        // 构造 JSON 数组
//        JSONArray jsonArray = new JSONArray(codes);
//
//        // 生成文件名，去掉疾病名称中的特殊字符，防止文件名非法
//        String sanitizedDisease = disease.replaceAll("[\\\\/:*?\"<>|]", "_");
//        String filePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\"
//                + sanitizedDisease + "_codes.json";
//
//        // 保存到文件
//        try (FileWriter writer = new FileWriter(filePath)) {
//            writer.write(jsonArray.toStringPretty()); // 格式化输出 JSON
//            System.out.println("Codes for disease '" + disease + "' have been saved to: " + filePath);
//        }
//    }
//
//    @Transactional
//    public void batchInsert() {
//        synchronized (this) {
//            if (!foodList.isEmpty()) {
//                foodMapper.batchInsert(foodList);
//                foodList.clear();
//            }
//            if (!glycemicIndexList.isEmpty()) {
//                glycemicIndexMapper.batchInsert(glycemicIndexList);
//                glycemicIndexList.clear();
//            }
//            if (!mineralsList.isEmpty()) {
//                mineralsMapper.batchInsert(mineralsList);
//                mineralsList.clear();
//            }
//            if (!nutritionList.isEmpty()) {
//                nutritionMapper.batchInsert(nutritionList);
//                nutritionList.clear();
//            }
//            if (!vitaminsList.isEmpty()) {
//                vitaminsMapper.batchInsert(vitaminsList);
//                vitaminsList.clear();
//            }
//        }
//    }
//    /**
//     * 将代码列表保存为 JSON 格式文件
//     *
//     * @param codes 代码列表
//     * @throws IOException 如果发生文件写入错误
//     */
//    private void saveCodesToFile(List<String> codes) throws IOException {
//        // 构造 JSON 数组
//        JSONArray jsonArray = new JSONArray(codes);
//
//        // 保存到文件（指定文件路径）
//        String filePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\codes.json";
//        try (FileWriter writer = new FileWriter(filePath)) {
//            writer.write(jsonArray.toStringPretty()); // 格式化输出 JSON
//            System.out.println("Codes have been saved to: " + filePath);
//        }
//    }
//
//    // 解析响应数据并将其添加到实体类中
//    public void mapResponseToEntities(Map<String, Object> response) {
//        // 检查是否存在 id 字段
//        Object idValue = UUID.randomUUID().getMostSignificantBits() & Long.MAX_VALUE; // 生成正数的随机 ID
//        // Food 实体类映射
//        Food food = new Food();
//        food.setId(((Number) idValue).longValue());
//        food.setCode((String) response.getOrDefault("code", "")); // 如果没有 code，则默认空字符串
//        Map<String, Object> basicSection = (Map<String, Object>) response.get("basic_section");
//        if (basicSection != null) {
//            food.setName((String) basicSection.getOrDefault("name", ""));
//            food.setHealthLight(((Number) basicSection.getOrDefault("health_light", 0)).intValue());
//            food.setHealthLabel((String) basicSection.getOrDefault("health_label", ""));
//            food.setSuggest((String) basicSection.getOrDefault("suggest", ""));
//            food.setThumbImageUrl((String) basicSection.getOrDefault("thumb_image_url", ""));
//            food.setLargeImageUrl((String) basicSection.getOrDefault("large_image_url", ""));
//        }
//        food.setIsDynamicDish((Boolean) response.getOrDefault("is_dynamic_dish", false));
//        food.setContrastPhotoUrl((String) response.getOrDefault("contrast_photo_url", ""));
//        food.setIsLiquid((Boolean) response.getOrDefault("is_liquid", false));
//
//        foodList.add(food);
//        // GlycemicIndex 实体类映射
//        GlycemicIndex glycemicIndex = new GlycemicIndex();
//        glycemicIndex.setFoodId(food.getId());
//
//        // 安全地解析 glycemic_section -> gi -> value 和 label
//        Map<String, Object> glycemicSection = (Map<String, Object>) response.get("glycemic_section");
//        if (glycemicSection != null) {
//            Map<String, Object> gi = (Map<String, Object>) glycemicSection.get("gi");
//            if (gi != null) {
//                glycemicIndex.setGiValue(parseFloatSafe(gi.get("value")));
//                glycemicIndex.setGiLabel((String) gi.getOrDefault("label", ""));
//            }
//
//            Map<String, Object> gl = (Map<String, Object>) glycemicSection.get("gl");
//            if (gl != null) {
//                glycemicIndex.setGlValue(parseFloatSafe(gl.get("value")));
//                glycemicIndex.setGlLabel((String) gl.getOrDefault("label", ""));
//            }
//        }
//
//        glycemicIndexList.add(glycemicIndex);
//
//        // Minerals 实体类映射
//        Minerals minerals = new Minerals();
//        minerals.setFoodId(food.getId());
//        Map<String, Object> ingredientSection = (Map<String, Object>) response.get("ingredient_section");
//        if (ingredientSection != null) {
//            Map<String, Object> mineralsMap = (Map<String, Object>) ingredientSection.get("minerals_ingredient");
//            if (mineralsMap != null) {
//                minerals.setPhosphor(parseFloatSafe(mineralsMap.get("phosphor")));
//                minerals.setKalium(parseFloatSafe(mineralsMap.get("kalium")));
//                minerals.setMagnesium(parseFloatSafe(mineralsMap.get("magnesium")));
//                minerals.setCalcium(parseFloatSafe(mineralsMap.get("calcium")));
//                minerals.setIron(parseFloatSafe(mineralsMap.get("iron")));
//                minerals.setZinc(parseFloatSafe(mineralsMap.get("zinc")));
//                minerals.setIodine(parseFloatSafe(mineralsMap.get("iodine")));
//                minerals.setSelenium(parseFloatSafe(mineralsMap.get("selenium")));
//                minerals.setCopper(parseFloatSafe(mineralsMap.get("copper")));
//                minerals.setFluorine(parseFloatSafe(mineralsMap.get("fluorine")));
//                minerals.setManganese(parseFloatSafe(mineralsMap.get("manganese")));
//            }
//        }
//
//        mineralsList.add(minerals);
//        // Nutrition 实体类映射
//        Nutrition nutrition = new Nutrition();
//        nutrition.setFoodId(food.getId());
//        if (ingredientSection != null) {
//            Map<String, Object> mainIngredient = (Map<String, Object>) ingredientSection.get("main_ingredient");
//            if (mainIngredient != null) {
//                nutrition.setCalory(parseFloatSafe(mainIngredient.get("calory")));
//                nutrition.setProtein(parseFloatSafe(mainIngredient.get("protein")));
//                nutrition.setFat(parseFloatSafe(mainIngredient.get("fat")));
//                nutrition.setCarbohydrate(parseFloatSafe(mainIngredient.get("carbohydrate")));
//                nutrition.setFiberDietary(parseFloatSafe(mainIngredient.get("fiber_dietary")));
//                nutrition.setNatrium(parseFloatSafe(mainIngredient.get("natrium")));
//            }
//        }
//        nutritionList.add(nutrition);
//
//        // Vitamins 实体类映射
//        Vitamins vitamins = new Vitamins();
//        vitamins.setFood(food);
//        if (ingredientSection != null) {
//            Map<String, Object> vitaminIngredient = (Map<String, Object>) ingredientSection.get("vitamin_ingredient");
//            if (vitaminIngredient != null) {
//                vitamins.setFoodId(food.getId());
//                vitamins.setVitaminA(parseFloatSafe(vitaminIngredient.get("vitamin_a")));
//                vitamins.setCarotene(parseFloatSafe(vitaminIngredient.get("carotene")));
//                vitamins.setVitaminD(parseFloatSafe(vitaminIngredient.get("vitamin_d")));
//                vitamins.setVitaminE(parseFloatSafe(vitaminIngredient.get("vitamin_e")));
//                vitamins.setThiamine(parseFloatSafe(vitaminIngredient.get("thiamine")));
//                vitamins.setLactoflavin(parseFloatSafe(vitaminIngredient.get("lactoflavin")));
//                vitamins.setVitaminC(parseFloatSafe(vitaminIngredient.get("vitamin_c")));
//                vitamins.setNiacin(parseFloatSafe(vitaminIngredient.get("niacin")));
//                vitamins.setRetinol(vitaminIngredient.get("retinol") != null ? parseFloatSafe(vitaminIngredient.get("retinol")) : null);
//            }
//        }
//        vitaminsList.add(vitamins);
//    }
//
//
//    private Float parseFloatSafe(Object value) {
//        try {
//            return value != null && !value.toString().isEmpty() ? Float.parseFloat(value.toString()) : 0.0f;
//        } catch (NumberFormatException e) {
//            // 如果解析失败，返回默认值
//            return 0.0f;
//        }
//    }
//
//}
