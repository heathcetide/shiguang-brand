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
//    //    @Scheduled(cron = "0 0/5 * * * ?") // 每5分钟执行一次
////    @Scheduled(cron = "0/5 * * * * ?")
////    @PostConstruct
////    public void executeTask() throws IOException {
////        // 创建一个 ArrayList 来存储所有的 code
////        List<String> codes = new ArrayList<>();
////
////        // 动态分页获取数据
////        int page = 1;
////        while (true) {
////            // 构造带分页的 URL
////            String url = "https://food.boohee.com//fb/v1/foods?value=12&kind=group&page=" + page + "&order_asc=0";
////            // 11 1007 12 36  10 263 8 34
////            // 发起GET请求
////            String response = HttpRequest.get(url)
////                    .execute()
////                    .body();
////
////            // 解析JSON响应
////            JSONObject responseObject = new JSONObject(response);
////
////            // 获取 foods 数组
////            JSONArray foodsArray = responseObject.getJSONArray("foods");
////
////            // 如果 foods 数组为空，停止循环
////            if (foodsArray == null || foodsArray.isEmpty() || page == 36) { //227
////                break;
////            }
////
////            // 遍历 foods 数组并提取 code 字段
////            for (Object food : foodsArray) {
////                JSONObject foodObject = (JSONObject) food;
////                String code = foodObject.getStr("code");
////                codes.add(code);
////            }
////            System.out.println("page 当前页面："+ page+"页");
////            // 增加分页计数
////            page++;
////        }
////        saveCodesToFile(codes);
//////        // 定义 JSON 文件路径
//////        String filePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\codes.json";
//////
//////        // 使用 Jackson 的 ObjectMapper 解析 JSON 文件
//////        ObjectMapper objectMapper = new ObjectMapper();
////        try {
////            // 读取文件并解析为 List<String>
//////            codes = objectMapper.readValue(new File(filePath), List.class);
////
////            for (String code : codes) {
////                try {
////                    // 1. 发送 GET 请求获取数据
////                    String url = "https://food.boohee.com//fb/v2/foods/" + code + "/detail?token=NatakoYQ6we4cdchwuUzCyGT3gDHm9aB";
////
////                    // 添加请求头，伪造请求来源
////                    String result = HttpRequest.get(url)
////                            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36")
////                            .header("Referer", "https://food.boohee.com")
////                            .header("Accept-Language", "en-US,en;q=0.9")
//////                            .header("X-Forwarded-For", getRandomIp()) // 伪造 IP
////                            .execute()
////                            .body();
////
////                    // 检查如果 result 是空字符串则跳过
////                    if (result == null || result.trim().isEmpty() || result.equals("{}")) {
////                        System.out.println("获取到的结果为空，跳过 code: " + code);
////                        continue; // 跳过当前循环
////                    }
////                    // 将响应写入文件
////                    File file = new File("G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\codes.json");
////                    try (FileOutputStream fileOutputStream = new FileOutputStream(file)) {
////                        fileOutputStream.write(result.getBytes());
////                    }
////
////                    // 使用 Jackson 将 JSON 字符串解析为 Map
////                    Map<String, Object> response = objectMapper.readValue(result, new TypeReference<>() {});
////
////                    // 调用 mapResponseToEntities 函数
////                    mapResponseToEntities(response);
////                    System.out.print("存");
////                    if (foodList.size() >= BATCH_SIZE) {
////                        System.out.println("插入数据了"+ foodList.get(180).getCode());
////                        batchInsert(); // 批量插入
////                    }
////                    // 添加延迟，防止被服务器封禁
////                    Thread.sleep(300);
////                } catch (InterruptedException e) {
////                    throw new RuntimeException(e);
////                }
////            }
////        } catch (IOException e) {
////            System.err.println("读取 JSON 文件失败: " + e.getMessage());
////            e.printStackTrace();
////        }
////        batchInsert(); // 批量插入
////    }
//
//    private static final int THREAD_POOL_SIZE = 20; // 线程池大小
//    private final ExecutorService executorService = Executors.newFixedThreadPool(THREAD_POOL_SIZE);
//
//
//    @PostConstruct
//    public void executeTask() throws IOException {
////        List<String> codes = fetchCodes(); // 获取所有的 `code`
//        List<String> codes;
//        // 定义 JSON 文件路径
//        String filePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\codes.json";
//
//        // 使用 Jackson 的 ObjectMapper 解析 JSON 文件
//        ObjectMapper objectMapper = new ObjectMapper();
//
//        codes = objectMapper.readValue(new File(filePath), List.class);
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
//        List<String> codes = new ArrayList<>();
//        int page = 40;
//        while (true) {
//            String url = "https://food.boohee.com//fb/v1/foods?value=11&kind=group&page=" + page + "&order_asc=0";
//            String response = HttpRequest.get(url).execute().body();
//            JSONObject responseObject = new JSONObject(response);
//            JSONArray foodsArray = responseObject.getJSONArray("foods");
//
//            if (page == 1007) { // 停止条件1007
//                break;
//            }
//
//            for (Object food : foodsArray) {
//                JSONObject foodObject = (JSONObject) food;
//                codes.add(foodObject.getStr("code"));
//            }
//            System.out.println("当前页面: 第 " + page + " 页");
//            page++;
//        }
//        saveCodesToFile(codes);
//        return codes;
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
////    @Async
////    @Transactional
////    protected void batchInsert() {
////        if (!foodList.isEmpty()) {
////            foodMapper.batchInsert(foodList);
////            foodList.clear();
////        }
////        if (!glycemicIndexList.isEmpty()) {
////            glycemicIndexMapper.batchInsert(glycemicIndexList);
////            glycemicIndexList.clear();
////        }
////        if (!mineralsList.isEmpty()) {
////            mineralsMapper.batchInsert(mineralsList);
////            mineralsList.clear();
////        }
////        if (!nutritionList.isEmpty()) {
////            nutritionMapper.batchInsert(nutritionList);
////            nutritionList.clear();
////        }
////        if (!vitaminsList.isEmpty()) {
////            vitaminsMapper.batchInsert(vitaminsList);
////            vitaminsList.clear();
////        }
////    }
//
//
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
