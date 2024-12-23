package com.foodrecord.task.once;

import cn.hutool.core.lang.UUID;
import cn.hutool.http.HttpRequest;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.mapper.*;
import com.foodrecord.model.entity.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.PostConstruct;
import java.io.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;

@Component
public class GrabFood {

    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final List<Food> foodList = new CopyOnWriteArrayList<>();
    private final List<GlycemicIndex> glycemicIndexList = new CopyOnWriteArrayList<>();
    private final List<Minerals> mineralsList = new CopyOnWriteArrayList<>();
    private final List<Nutrition> nutritionList = new CopyOnWriteArrayList<>();
    private final List<Vitamins> vitaminsList = new CopyOnWriteArrayList<>();
//    private final List<Food> foodList = new ArrayList<>();
//    private final List<GlycemicIndex> glycemicIndexList = new ArrayList<>();
//    private final List<Minerals> mineralsList = new ArrayList<>();
//    private final List<Nutrition> nutritionList = new ArrayList<>();
//    private final List<Vitamins> vitaminsList = new ArrayList<>();

    @Autowired
    private FoodMapper foodMapper;

    @Autowired
    private VitaminsMapper vitaminsMapper;

    @Autowired
    private NutritionMapper nutritionMapper;

    @Autowired
    private GlycemicIndexMapper glycemicIndexMapper;

    @Autowired
    private MineralsMapper mineralsMapper;

    private static final int THREAD_POOL_SIZE = 20; // 线程池大小
    private final ExecutorService executorService = Executors.newFixedThreadPool(THREAD_POOL_SIZE);


//    @PostConstruct
    public void executeTask() throws IOException, ExecutionException, InterruptedException {
//        List<String> codes = fetchCodes(); // 获取所有的 `code`

        List<String> codes;
        // 定义 JSON 文件路径
        String filePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\all_codes.json";

        // 使用 Jackson 的 ObjectMapper 解析 JSON 文件
        ObjectMapper objectMapper = new ObjectMapper();

        codes = objectMapper.readValue(new File(filePath), List.class);
        List<Future<?>> futures = new ArrayList<>();

        // 多线程处理每个 `code`
        for (String code : codes) {
            futures.add(executorService.submit(() -> processCode(code)));
        }

        // 等待所有任务完成
        for (Future<?> future : futures) {
            try {
                future.get(); // 等待任务完成
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        // 插入剩余的数据
        batchInsert();

        // 关闭线程池
        executorService.shutdown();
    }

    private void processCode(String code) {
        try {
            String url = "https://food.boohee.com//fb/v2/foods/" + code + "/detail?token=NatakoYQ6we4cdchwuUzCyGT3gDHm9aB";
            String result = HttpRequest.get(url)
                    .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36")
                    .header("Referer", "https://food.boohee.com")
                    .header("Accept-Language", "en-US,en;q=0.9")
                    .execute()
                    .body();

            if (result == null || result.trim().isEmpty() || result.equals("{}")) {
                System.out.println("获取到的结果为空，跳过 code: " + code);
                return; // 跳过
            }

            Map<String, Object> response = objectMapper.readValue(result, new TypeReference<>() {
            });
            mapResponseToEntities(response);

            synchronized (this) {
                if (foodList.size() >= BATCH_SIZE) {
                    batchInsert(); // 达到批量大小，插入数据库
                }
            }

            Thread.sleep(300); // 防止请求过于频繁
        } catch (Exception e) {
            System.err.println("处理 code 出现异常: " + code);
            e.printStackTrace();
        }
    }

    private static final int START_ID = 1; // 起始值
    private static final int END_ID = 1389837; // 结束值
    private static final int THREAD_COUNT = 20; // 线程数量
    private static final int BATCH_SIZE = 800; // 每个线程处理的 ID 数量


    public List<String> fetchCodes() throws InterruptedException, ExecutionException, IOException {
        // 使用线程池
        ExecutorService executorService = Executors.newFixedThreadPool(THREAD_COUNT);
        List<Future<List<String>>> futures = new ArrayList<>();

        // 按照 BATCH_SIZE 切分任务
        for (int i = START_ID; i <= END_ID; i += BATCH_SIZE) {
            int start = i;
            int end = Math.min(i + BATCH_SIZE - 1, END_ID); // 防止超出范围

            // 提交任务到线程池
            futures.add(executorService.submit(() -> fetchCodesInRange(start, end)));
        }

        List<String> allCodes = new ArrayList<>();
        // 收集所有线程的结果
        for (Future<List<String>> future : futures) {
            allCodes.addAll(future.get());
        }

        // 关闭线程池
        executorService.shutdown();

        // 保存所有的 codes 到文件
        saveCodesToFile(allCodes);

        return allCodes;
    }

    /**
     * 获取指定范围内的 codes
     *
     * @param start 起始 ID
     * @param end   结束 ID
     * @return 该范围内的所有 code
     */
    private List<String> fetchCodesInRange(int start, int end) {
        List<String> codes = new ArrayList<>();
        for (int id = start; id <= end; id++) {
            try {
                // 构造动态 URL
                String url = "https://food.boohee.com/fb/v1/drink_foods/" + id + "?token=NatakoYQ6we4cdchwuUzCyGT3gDHm9aB";
                // 发送请求并获取响应
                String response = HttpRequest.get(url)
                        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36")
                        .execute()
                        .body();

                // 如果响应为空或无效，跳过
                if (response == null || response.trim().isEmpty() || response.equals("{}")) {
                    System.out.println("Empty response for ID: " + id);
                    continue;
                }
                System.out.print("添"); // 提示请求进度

                // 解析响应为 JSON
                JSONObject responseObject = new JSONObject(response);

                // 确认 JSON 结构是否有 `data` 节点
                if (!responseObject.containsKey("data")) {
                    System.out.println("No 'data' field for ID: " + id);
                    continue;
                }

                // 获取 `data` 节点
                JSONObject dataObject = responseObject.getJSONObject("data");

                // 确认 `data` 节点是否有 `food` 节点
                if (!dataObject.containsKey("food")) {
                    System.out.println("No 'food' field in 'data' for ID: " + id);
                    continue;
                }

                // 获取 `food` 节点
                JSONObject foodObject = dataObject.getJSONObject("food");

                // 提取 `code` 字段
                String code = foodObject.getStr("code");
                if (code != null && !code.isEmpty()) {
                    codes.add(code);
                }

            } catch (Exception e) {
                // 捕获异常，避免中断
                System.err.println("Error fetching data for ID: " + id);
                e.printStackTrace();
            }
        }
        System.out.println("Fetched codes from " + start + " to " + end + " (Total: " + codes.size() + ")");
        return codes;
    }


    @Transactional
    public void batchInsert() {
        synchronized (this) {
            if (!foodList.isEmpty()) {
                foodMapper.batchInsert(foodList);
                foodList.clear();
            }
            if (!glycemicIndexList.isEmpty()) {
                glycemicIndexMapper.batchInsert(glycemicIndexList);
                glycemicIndexList.clear();
            }
            if (!mineralsList.isEmpty()) {
                mineralsMapper.batchInsert(mineralsList);
                mineralsList.clear();
            }
            if (!nutritionList.isEmpty()) {
                nutritionMapper.batchInsert(nutritionList);
                nutritionList.clear();
            }
            if (!vitaminsList.isEmpty()) {
                vitaminsMapper.batchInsert(vitaminsList);
                vitaminsList.clear();
            }
        }
    }
    /**
     * 将代码列表保存为 JSON 格式文件
     *
     * @param codes 代码列表
     * @throws IOException 如果发生文件写入错误
     */
    private void saveCodesToFile(List<String> codes) throws IOException {
        // 构造 JSON 数组
        JSONArray jsonArray = new JSONArray(codes);

        // 保存到文件（指定文件路径）
        String filePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\all_codes.json";
        try (FileWriter writer = new FileWriter(filePath)) {
            writer.write(jsonArray.toStringPretty()); // 格式化输出 JSON
            System.out.println("Codes have been saved to: " + filePath);
        }
    }

    // 解析响应数据并将其添加到实体类中
    public void mapResponseToEntities(Map<String, Object> response) {
        // 检查是否存在 id 字段
        Object idValue = UUID.randomUUID().getMostSignificantBits() & Long.MAX_VALUE; // 生成正数的随机 ID
        // Food 实体类映射
        Food food = new Food();
        food.setId(((Number) idValue).longValue());
        food.setCode((String) response.getOrDefault("code", "")); // 如果没有 code，则默认空字符串
        Map<String, Object> basicSection = (Map<String, Object>) response.get("basic_section");
        if (basicSection != null) {
            food.setName((String) basicSection.getOrDefault("name", ""));
            food.setHealthLight(((Number) basicSection.getOrDefault("health_light", 0)).intValue());
            food.setHealthLabel((String) basicSection.getOrDefault("health_label", ""));
            food.setSuggest((String) basicSection.getOrDefault("suggest", ""));
            food.setThumbImageUrl((String) basicSection.getOrDefault("thumb_image_url", ""));
            food.setLargeImageUrl((String) basicSection.getOrDefault("large_image_url", ""));
        }
        food.setIsDynamicDish((Boolean) response.getOrDefault("is_dynamic_dish", false));
        food.setContrastPhotoUrl((String) response.getOrDefault("contrast_photo_url", ""));
        food.setIsLiquid((Boolean) response.getOrDefault("is_liquid", false));

        foodList.add(food);
        // GlycemicIndex 实体类映射
        GlycemicIndex glycemicIndex = new GlycemicIndex();
        glycemicIndex.setFoodId(food.getId());

        // 安全地解析 glycemic_section -> gi -> value 和 label
        Map<String, Object> glycemicSection = (Map<String, Object>) response.get("glycemic_section");
        if (glycemicSection != null) {
            Map<String, Object> gi = (Map<String, Object>) glycemicSection.get("gi");
            if (gi != null) {
                glycemicIndex.setGiValue(parseFloatSafe(gi.get("value")));
                glycemicIndex.setGiLabel((String) gi.getOrDefault("label", ""));
            }

            Map<String, Object> gl = (Map<String, Object>) glycemicSection.get("gl");
            if (gl != null) {
                glycemicIndex.setGlValue(parseFloatSafe(gl.get("value")));
                glycemicIndex.setGlLabel((String) gl.getOrDefault("label", ""));
            }
        }

        glycemicIndexList.add(glycemicIndex);

        // Minerals 实体类映射
        Minerals minerals = new Minerals();
        minerals.setFoodId(food.getId());
        Map<String, Object> ingredientSection = (Map<String, Object>) response.get("ingredient_section");
        if (ingredientSection != null) {
            Map<String, Object> mineralsMap = (Map<String, Object>) ingredientSection.get("minerals_ingredient");
            if (mineralsMap != null) {
                minerals.setPhosphor(parseFloatSafe(mineralsMap.get("phosphor")));
                minerals.setKalium(parseFloatSafe(mineralsMap.get("kalium")));
                minerals.setMagnesium(parseFloatSafe(mineralsMap.get("magnesium")));
                minerals.setCalcium(parseFloatSafe(mineralsMap.get("calcium")));
                minerals.setIron(parseFloatSafe(mineralsMap.get("iron")));
                minerals.setZinc(parseFloatSafe(mineralsMap.get("zinc")));
                minerals.setIodine(parseFloatSafe(mineralsMap.get("iodine")));
                minerals.setSelenium(parseFloatSafe(mineralsMap.get("selenium")));
                minerals.setCopper(parseFloatSafe(mineralsMap.get("copper")));
                minerals.setFluorine(parseFloatSafe(mineralsMap.get("fluorine")));
                minerals.setManganese(parseFloatSafe(mineralsMap.get("manganese")));
            }
        }

        mineralsList.add(minerals);
        // Nutrition 实体类映射
        Nutrition nutrition = new Nutrition();
        nutrition.setFoodId(food.getId());
        if (ingredientSection != null) {
            Map<String, Object> mainIngredient = (Map<String, Object>) ingredientSection.get("main_ingredient");
            if (mainIngredient != null) {
                nutrition.setCalory(parseFloatSafe(mainIngredient.get("calory")));
                nutrition.setProtein(parseFloatSafe(mainIngredient.get("protein")));
                nutrition.setFat(parseFloatSafe(mainIngredient.get("fat")));
                nutrition.setCarbohydrate(parseFloatSafe(mainIngredient.get("carbohydrate")));
                nutrition.setFiberDietary(parseFloatSafe(mainIngredient.get("fiber_dietary")));
                nutrition.setNatrium(parseFloatSafe(mainIngredient.get("natrium")));
            }
        }
        nutritionList.add(nutrition);

        // Vitamins 实体类映射
        Vitamins vitamins = new Vitamins();
        vitamins.setFood(food);
        if (ingredientSection != null) {
            Map<String, Object> vitaminIngredient = (Map<String, Object>) ingredientSection.get("vitamin_ingredient");
            if (vitaminIngredient != null) {
                vitamins.setFoodId(food.getId());
                vitamins.setVitaminA(parseFloatSafe(vitaminIngredient.get("vitamin_a")));
                vitamins.setCarotene(parseFloatSafe(vitaminIngredient.get("carotene")));
                vitamins.setVitaminD(parseFloatSafe(vitaminIngredient.get("vitamin_d")));
                vitamins.setVitaminE(parseFloatSafe(vitaminIngredient.get("vitamin_e")));
                vitamins.setThiamine(parseFloatSafe(vitaminIngredient.get("thiamine")));
                vitamins.setLactoflavin(parseFloatSafe(vitaminIngredient.get("lactoflavin")));
                vitamins.setVitaminC(parseFloatSafe(vitaminIngredient.get("vitamin_c")));
                vitamins.setNiacin(parseFloatSafe(vitaminIngredient.get("niacin")));
                vitamins.setRetinol(vitaminIngredient.get("retinol") != null ? parseFloatSafe(vitaminIngredient.get("retinol")) : null);
            }
        }
        vitaminsList.add(vitamins);
    }


    private Float parseFloatSafe(Object value) {
        try {
            return value != null && !value.toString().isEmpty() ? Float.parseFloat(value.toString()) : 0.0f;
        } catch (NumberFormatException e) {
            // 如果解析失败，返回默认值
            return 0.0f;
        }
    }

}
