//package com.foodrecord.service.nutrition;
//
//import com.foodrecord.model.entity.*;
//import com.foodrecord.repository.NutritionAdviceRepository;
//import com.foodrecord.service.FoodService;
//import com.foodrecord.service.impl.UserDietStatsServiceImpl;
//import lombok.RequiredArgsConstructor;
//import org.springframework.stereotype.Service;
//import org.springframework.transaction.annotation.Transactional;
//
//import java.time.LocalTime;
//import java.util.*;
//import java.util.stream.Collectors;
//
///**
// * 营养建议生成服务实现类
// */
//@Service
//@RequiredArgsConstructor
//public class NutritionAdviceServiceImpl implements NutritionAdviceService {
//    private final UserDietStatsServiceImpl dietStatsService;
//    private final NutritionAnalysisService nutritionAnalysisService;
//    private final NutritionAdviceRepository adviceRepository;
//    private final FoodService foodService;
//
//    @Override
//    @Transactional
//    public NutritionAdvice generateAdvice(Long userId) {
//        // 1. 获取用户近期饮食统计
//        UserDietStats recentStats = dietStatsService.getRecentStats(userId);
//
//        // 2. 分析营养状况
//        NutritionAnalysis analysis = nutritionAnalysisService.analyze(userId);
//
//        // 3. 生成建议
//        NutritionAdvice advice = new NutritionAdvice();
//
//        // 3.1 营养素建议
//        Map<String, NutrientAdvice> nutrientAdvices = generateNutrientAdvice(analysis);
//        advice.setNutrientAdvices(nutrientAdvices);
//
//        // 3.2 食物选择建议
//        List<FoodChoiceAdvice> foodChoiceAdvices = generateFoodChoiceAdvice(analysis);
//        advice.setFoodChoiceAdvices(foodChoiceAdvices);
//
//        // 3.3 饮食习惯建议
//        List<DietaryHabitAdvice> habitAdvices = generateDietaryHabitAdvice(recentStats);
//        advice.setHabitAdvices(habitAdvices);
//
//        // 3.4 健康警告
//        List<HealthWarning> healthWarnings = generateHealthWarnings(analysis);
//        advice.setHealthWarnings(healthWarnings);
//
//        // 3.5 计算总体评分
//        double overallScore = calculateOverallScore(analysis);
//        advice.setOverallScore(overallScore);
//
//        // 3.6 生成改进建议
//        String improvementSuggestions = generateImprovementSuggestions(
//            nutrientAdvices, foodChoiceAdvices, habitAdvices, healthWarnings);
//        advice.setImprovementSuggestions(improvementSuggestions);
//
//        // 4. 保存建议
//        return adviceRepository.save(advice);
//    }
//
//    /**
//     * 生成营养素建议
//     */
//    private Map<String, NutrientAdvice> generateNutrientAdvice(NutritionAnalysis analysis) {
//        Map<String, NutrientAdvice> advices = new HashMap<>();
//
//        // 蛋白质建议
//        advices.put("protein", generateProteinAdvice(analysis));
//
//        // 脂肪建议
//        advices.put("fat", generateFatAdvice(analysis));
//
//        // 碳水化合物建议
//        advices.put("carbohydrate", generateCarbAdvice(analysis));
//
//        // 维生素建议
//        advices.put("vitamins", generateVitaminAdvice(analysis));
//
//        // 矿物质建议
//        advices.put("minerals", generateMineralAdvice(analysis));
//
//        return advices;
//    }
//
//    /**
//     * 生成蛋白质建议
//     */
//    private NutrientAdvice generateProteinAdvice(NutritionAnalysis analysis) {
//        NutrientAdvice advice = new NutrientAdvice();
//        advice.setNutrientName("蛋白质");
//
//        double current = analysis.getProteinBalance();
//        double target = 1.0; // 目标平衡值
//
//        advice.setCurrentIntake(current);
//        advice.setTargetIntake(target);
//        advice.setDeviation((current - target) / target * 100);
//
//        // 根据偏差生成建议
//        if (current < target * 0.8) {
//            advice.setSuggestion("蛋白质摄入不足，建议增加瘦肉、鱼、蛋类等优质蛋白的摄入");
//            advice.setRecommendedFoods(findHighProteinFoods());
//        } else if (current > target * 1.2) {
//            advice.setSuggestion("蛋白质摄入过多，建议适当减少肉类摄入，增加蔬菜水果");
//            advice.setRecommendedFoods(findLowProteinFoods());
//        } else {
//            advice.setSuggestion("蛋白质摄入适中，建议保持当前饮食习惯");
//            advice.setRecommendedFoods(findBalancedProteinFoods());
//        }
//
//        return advice;
//    }
//
//    /**
//     * 生成脂肪建议
//     */
//    private NutrientAdvice generateFatAdvice(NutritionAnalysis analysis) {
//        NutrientAdvice advice = new NutrientAdvice();
//        advice.setNutrientName("脂肪");
//
//        double current = analysis.getFatBalance();
//        double target = 1.0;
//
//        advice.setCurrentIntake(current);
//        advice.setTargetIntake(target);
//        advice.setDeviation((current - target) / target * 100);
//
//        // 分析脂肪类型
//        double saturatedFatRatio = analysis.getSaturatedFatRatio();
//
//        if (current < target * 0.8) {
//            advice.setSuggestion("脂肪摄入不足，建议适量增加优质油脂的摄入，如橄榄油、坚果等");
//            advice.setRecommendedFoods(findHealthyFatFoods());
//        } else if (current > target * 1.2) {
//            if (saturatedFatRatio > 0.33) { // 饱和脂肪占比过高
//                advice.setSuggestion("脂肪摄入过多且饱和脂肪占比过高，建议减少动物性脂肪摄入，选择植物油");
//            } else {
//                advice.setSuggestion("脂肪摄入略高，建议适当控制用油量");
//            }
//            advice.setRecommendedFoods(findLowFatFoods());
//        } else {
//            advice.setSuggestion("脂肪摄入适中，建议保持当前饮食习惯，注意控制饱和脂肪的摄入");
//            advice.setRecommendedFoods(findBalancedFatFoods());
//        }
//
//        return advice;
//    }
//
//    /**
//     * 生成碳水化合物建议
//     */
//    private NutrientAdvice generateCarbAdvice(NutritionAnalysis analysis) {
//        NutrientAdvice advice = new NutrientAdvice();
//        advice.setNutrientName("碳水化合物");
//
//        double current = analysis.getCarbBalance();
//        double target = 1.0;
//        double fiberIntake = analysis.getFiberIntake();
//
//        advice.setCurrentIntake(current);
//        advice.setTargetIntake(target);
//        advice.setDeviation((current - target) / target * 100);
//
//        if (current < target * 0.8) {
//            advice.setSuggestion("碳水化合物摄入不足，建议适量增加全谷物、薯类等优质碳水化合物的摄入");
//            advice.setRecommendedFoods(findComplexCarbFoods());
//        } else if (current > target * 1.2) {
//            if (fiberIntake < 25) { // 纤维摄入不足
//                advice.setSuggestion("碳水化合物摄入过多且膳食纤维不足，建议减少精制碳水化合物，增加全谷物摄入");
//            } else {
//                advice.setSuggestion("碳水化合物摄入过多，建议控制主食量，选择低GI食物");
//            }
//            advice.setRecommendedFoods(findLowGIFoods());
//        } else {
//            advice.setSuggestion("碳水化合物摄入适中，建议保持当前摄入量，注意增加膳食纤维的摄入");
//            advice.setRecommendedFoods(findHighFiberFoods());
//        }
//
//        return advice;
//    }
//
//    /**
//     * 生成维生素建议
//     */
//    private NutrientAdvice generateVitaminAdvice(NutritionAnalysis analysis) {
//        NutrientAdvice advice = new NutrientAdvice();
//        advice.setNutrientName("维生素");
//
//        // 分析各种维生素的摄入情况
//        Map<String, Double> vitaminLevels = analysis.getVitaminLevels();
//        List<String> deficientVitamins = new ArrayList<>();
//        List<String> excessiveVitamins = new ArrayList<>();
//
//        vitaminLevels.forEach((vitamin, level) -> {
//            if (level < 0.8) {
//                deficientVitamins.add(vitamin);
//            } else if (level > 1.5) {
//                excessiveVitamins.add(vitamin);
//            }
//        });
//
//        StringBuilder suggestion = new StringBuilder();
//        if (!deficientVitamins.isEmpty()) {
//            suggestion.append("存在").append(String.join("、", deficientVitamins))
//                     .append("等维生素摄入不足的情况，");
//            advice.setRecommendedFoods(findVitaminRichFoods(deficientVitamins));
//        }
//
//        if (!excessiveVitamins.isEmpty()) {
//            suggestion.append("注意控制").append(String.join("、", excessiveVitamins))
//                     .append("的补充剂使用。");
//        }
//
//        if (deficientVitamins.isEmpty() && excessiveVitamins.isEmpty()) {
//            suggestion.append("维生素摄入总体均衡，建议保持当前饮食结构。");
//        }
//
//        advice.setSuggestion(suggestion.toString());
//        return advice;
//    }
//
//    /**
//     * 生成矿物质建议
//     */
//    private NutrientAdvice generateMineralAdvice(NutritionAnalysis analysis) {
//        NutrientAdvice advice = new NutrientAdvice();
//        advice.setNutrientName("矿物质");
//
//        // 分析各种矿物质的摄入情况
//        Map<String, Double> mineralLevels = analysis.getMineralLevels();
//        Map<String, String> mineralFoodSources = new HashMap<>();
//        mineralFoodSources.put("calcium", "奶制品、豆制品、深绿色蔬菜");
//        mineralFoodSources.put("iron", "红肉、动物内脏、深色叶菜");
//        mineralFoodSources.put("zinc", "牡蛎、瘦肉、坚果");
//
//        StringBuilder suggestion = new StringBuilder();
//        List<Food> recommendedFoods = new ArrayList<>();
//
//        mineralLevels.forEach((mineral, level) -> {
//            if (level < 0.8) {
//                suggestion.append(mineral).append("摄入不足，建议多食用")
//                         .append(mineralFoodSources.get(mineral)).append("；");
//                recommendedFoods.addAll(findMineralRichFoods(mineral));
//            }
//        });
//
//        if (suggestion.length() == 0) {
//            suggestion.append("矿物质摄入总体均衡，建议保持当前饮食结构。");
//        }
//
//        advice.setSuggestion(suggestion.toString());
//        advice.setRecommendedFoods(recommendedFoods);
//        return advice;
//    }
//
//    /**
//     * 生成食物选择建议
//     */
//    private List<FoodChoiceAdvice> generateFoodChoiceAdvice(NutritionAnalysis analysis) {
//        List<FoodChoiceAdvice> advices = new ArrayList<>();
//
//        // 1. 主食建议
//        advices.add(generateStapleAdvice(analysis));
//
//        // 2. 蛋白质食物建议
//        advices.add(generateProteinFoodAdvice(analysis));
//
//        // 3. 蔬菜水果建议
//        advices.add(generateVegetableFruitAdvice(analysis));
//
//        // 4. 油脂建议
//        advices.add(generateOilAdvice(analysis));
//
//        return advices;
//    }
//
//    /**
//     * 生成饮食习惯建议
//     */
//    private List<DietaryHabitAdvice> generateDietaryHabitAdvice(UserDietStats stats) {
//        List<DietaryHabitAdvice> advices = new ArrayList<>();
//
//        // 1. 餐次规律性建议
//        advices.add(generateMealRegularityAdvice(stats));
//
//        // 2. 能量分配建议
//        advices.add(generateEnergyDistributionAdvice(stats));
//
//        // 3. 饮食多样性建议
//        advices.add(generateDietaryDiversityAdvice(stats));
//
//        return advices;
//    }
//
//    /**
//     * 生成健康警告
//     */
//    private List<HealthWarning> generateHealthWarnings(NutritionAnalysis analysis) {
//        List<HealthWarning> warnings = new ArrayList<>();
//
//        // 检查各项营养指标是否存在严重差
//        checkNutrientImbalance(analysis, warnings);
//
//        // 检查是否存在营养素缺乏风险
//        checkNutrientDeficiencyRisk(analysis, warnings);
//
//        // 检查是否存在过量风险
//        checkExcessiveIntakeRisk(analysis, warnings);
//
//        return warnings;
//    }
//
//    /**
//     * 生成主食建议
//     */
//    private FoodChoiceAdvice generateStapleAdvice(NutritionAnalysis analysis) {
//        FoodChoiceAdvice advice = new FoodChoiceAdvice();
//        advice.setFoodCategory("主食");
//
//        double carbRatio = analysis.getCarbRatio();
//        double fiberIntake = analysis.getFiberIntake();
//        double wholeGrainRatio = analysis.getWholeGrainRatio();
//
//        List<Food> increaseChoices = new ArrayList<>();
//        List<Food> decreaseChoices = new ArrayList<>();
//        StringBuilder reason = new StringBuilder();
//        StringBuilder suggestion = new StringBuilder();
//
//        // 分析主食摄入情况
//        if (carbRatio < 0.5) { // 碳水化合物比例过低
//            reason.append("碳水化合物占总能量比例过低(").append(String.format("%.1f%%", carbRatio * 100)).append(")；");
//            suggestion.append("适当增加主食摄入量；");
//            increaseChoices.addAll(findComplexCarbFoods());
//        } else if (carbRatio > 0.65) { // 碳水化合物比例过高
//            reason.append("碳水化合物占总能量比例过高(").append(String.format("%.1f%%", carbRatio * 100)).append(")；");
//            suggestion.append("适当减少主食摄入量；");
//            decreaseChoices.addAll(findRefinedCarbFoods());
//        }
//
//        // 分析膳食纤维摄入
//        if (fiberIntake < 25) {
//            reason.append("膳食纤维摄入不足(").append(String.format("%.1fg/天", fiberIntake)).append(")；");
//            suggestion.append("增加全谷物、杂粮的摄入；");
//            increaseChoices.addAll(findHighFiberStapleFoods());
//        }
//
//        // 分析全谷物比例
//        if (wholeGrainRatio < 0.3) {
//            reason.append("全谷物占比过低(").append(String.format("%.1f%%", wholeGrainRatio * 100)).append(")；");
//            suggestion.append("建议选择全麦面包、糙米等全谷物食品；");
//            increaseChoices.addAll(findWholeGrainFoods());
//            decreaseChoices.addAll(findRefinedGrainFoods());
//        }
//
//        if (reason.length() == 0) {
//            reason.append("主食摄入基本合理");
//            suggestion.append("保持当前主食摄入结构，注意食物多样性");
//        }
//
//        advice.setReason(reason.toString());
//        advice.setSuggestion(suggestion.toString());
//        advice.setIncreaseChoices(increaseChoices);
//        advice.setDecreaseChoices(decreaseChoices);
//
//        return advice;
//    }
//
//    /**
//     * 生成蛋白质食物建议
//     */
//    private FoodChoiceAdvice generateProteinFoodAdvice(NutritionAnalysis analysis) {
//        FoodChoiceAdvice advice = new FoodChoiceAdvice();
//        advice.setFoodCategory("蛋白质食物");
//
//        double proteinRatio = analysis.getProteinRatio();
//        double animalProteinRatio = analysis.getAnimalProteinRatio();
//        double fishIntake = analysis.getFishIntake();
//
//        List<Food> increaseChoices = new ArrayList<>();
//        List<Food> decreaseChoices = new ArrayList<>();
//        StringBuilder reason = new StringBuilder();
//        StringBuilder suggestion = new StringBuilder();
//
//        // 分析蛋白质摄入情况
//        if (proteinRatio < 0.12) {
//            reason.append("蛋白质摄入不足；");
//            suggestion.append("增加优质蛋白的摄入；");
//            increaseChoices.addAll(findHighQualityProteinFoods());
//        } else if (proteinRatio > 0.2) {
//            reason.append("蛋白质摄入过多；");
//            suggestion.append("适当减少肉类摄入；");
//            decreaseChoices.addAll(findHighFatMeatFoods());
//        }
//
//        // 分析动物蛋白比例
//        if (animalProteinRatio < 0.4) {
//            reason.append("动物蛋白比例偏低；");
//            suggestion.append("适当增加瘦肉、鱼类、蛋类等动物性食物；");
//            increaseChoices.addAll(findLeanMeatFoods());
//        } else if (animalProteinRatio > 0.7) {
//            reason.append("动物蛋白比例过高；");
//            suggestion.append("增加豆类等植物蛋白的摄入；");
//            increaseChoices.addAll(findPlantProteinFoods());
//            decreaseChoices.addAll(findHighFatMeatFoods());
//        }
//
//        // 分析鱼类摄入
//        if (fishIntake < 200) { // 建议每周摄入鱼类2-3次，每次100g
//            reason.append("鱼类摄入不足；");
//            suggestion.append("每周食用2-3次鱼类；");
//            increaseChoices.addAll(findFishFoods());
//        }
//
//        if (reason.length() == 0) {
//            reason.append("蛋白质食物摄入基本合理");
//            suggestion.append("保持当前蛋白质食物摄入结构，注意荤素搭配");
//        }
//
//        advice.setReason(reason.toString());
//        advice.setSuggestion(suggestion.toString());
//        advice.setIncreaseChoices(increaseChoices);
//        advice.setDecreaseChoices(decreaseChoices);
//
//        return advice;
//    }
//
//    /**
//     * 生成蔬菜水果建议
//     */
//    private FoodChoiceAdvice generateVegetableFruitAdvice(NutritionAnalysis analysis) {
//        FoodChoiceAdvice advice = new FoodChoiceAdvice();
//        advice.setFoodCategory("蔬菜水果");
//
//        double vegetableIntake = analysis.getVegetableIntake();
//        double fruitIntake = analysis.getFruitIntake();
//        double darkVegetableRatio = analysis.getDarkVegetableRatio();
//
//        List<Food> increaseChoices = new ArrayList<>();
//        List<Food> decreaseChoices = new ArrayList<>();
//        StringBuilder reason = new StringBuilder();
//        StringBuilder suggestion = new StringBuilder();
//
//        // 分析蔬菜摄入
//        if (vegetableIntake < 300) { // 建议每天摄入300-500g蔬菜
//            reason.append("蔬菜摄入不足(").append(String.format("%.0fg/天", vegetableIntake)).append(")；");
//            suggestion.append("增加蔬菜摄入量，每天应达到300-500g；");
//            increaseChoices.addAll(findSeasonalVegetables());
//        }
//
//        // 分析深色蔬菜比例
//        if (darkVegetableRatio < 0.5) { // 深色蔬菜应占50%以上
//            reason.append("深色蔬菜比例过高(").append(String.format("%.1f%%", darkVegetableRatio * 100)).append(")；");
//            suggestion.append("增加深绿色、红色等深色蔬菜的摄入；");
//            increaseChoices.addAll(findDarkVegetables());
//        }
//
//        // 分析水果摄入
//        if (fruitIntake < 200) { // 建议每天摄入200-350g水果
//            reason.append("水果摄入不足(").append(String.format("%.0fg/天", fruitIntake)).append(")；");
//            suggestion.append("增加水��摄入量，每天应达到200-350g；");
//            increaseChoices.addAll(findSeasonalFruits());
//        } else if (fruitIntake > 350) {
//            reason.append("水果摄入略多(").append(String.format("%.0fg/天", fruitIntake)).append(")；");
//            suggestion.append("适当控制水果摄入量，注意选择低糖水果；");
//            increaseChoices.addAll(findLowSugarFruits());
//        }
//
//        if (reason.length() == 0) {
//            reason.append("蔬菜水果摄入基本合理");
//            suggestion.append("保持当前摄入量，注意选择当季新鲜蔬果");
//        }
//
//        advice.setReason(reason.toString());
//        advice.setSuggestion(suggestion.toString());
//        advice.setIncreaseChoices(increaseChoices);
//        advice.setDecreaseChoices(decreaseChoices);
//
//        return advice;
//    }
//
//    /**
//     * 生成油脂建议
//     */
//    private FoodChoiceAdvice generateOilAdvice(NutritionAnalysis analysis) {
//        FoodChoiceAdvice advice = new FoodChoiceAdvice();
//        advice.setFoodCategory("油脂");
//
//        double oilIntake = analysis.getOilIntake();
//        double saturatedFatRatio = analysis.getSaturatedFatRatio();
//        double n3n6Ratio = analysis.getN3n6Ratio();
//
//        List<Food> increaseChoices = new ArrayList<>();
//        List<Food> decreaseChoices = new ArrayList<>();
//        StringBuilder reason = new StringBuilder();
//        StringBuilder suggestion = new StringBuilder();
//
//        // 分析烹调用量
//        if (oilIntake > 30) { // 建议每天烹调油不超过30g
//            reason.append("烹调油用量过多(").append(String.format("%.0fg/天", oilIntake)).append(")；");
//            suggestion.append("控制烹调油用量，每天不超过30g；");
//            decreaseChoices.addAll(findHighFatCookingMethods());
//        }
//
//        // 分析饱和脂肪酸比例
//        if (saturatedFatRatio > 0.33) { // 饱和脂肪酸不应超过总脂肪的1/3
//            reason.append("饱和脂肪酸比例过高(").append(String.format("%.1f%%", saturatedFatRatio * 100)).append(")；");
//            suggestion.append("减少动物性油脂摄入，选择植物油；");
//            increaseChoices.addAll(findHealthyOils());
//            decreaseChoices.addAll(findSaturatedFatSources());
//        }
//
//        // 分析n-3/n-6比例
//        if (n3n6Ratio < 0.1) { // n-3/n-6比例建议在1:4-1:10之间
//            reason.append("n-3脂肪酸摄入不足；");
//            suggestion.append("增加深海鱼、亚麻籽等富含n-3脂肪酸的食物；");
//            increaseChoices.addAll(findOmega3Sources());
//        }
//
//        if (reason.length() == 0) {
//            reason.append("油脂摄入基本合理");
//            suggestion.append("保持当前用油习惯，注意烹调方式的多样化");
//        }
//
//        advice.setReason(reason.toString());
//        advice.setSuggestion(suggestion.toString());
//        advice.setIncreaseChoices(increaseChoices);
//        advice.setDecreaseChoices(decreaseChoices);
//
//        return advice;
//    }
//
//    /**
//     * 生成餐次规律性建议
//     */
//    private DietaryHabitAdvice generateMealRegularityAdvice(UserDietStats stats) {
//        DietaryHabitAdvice advice = new DietaryHabitAdvice();
//        advice.setHabitType("餐次规律性");
//
//        // 分析用餐时间规律性
//        Map<String, LocalTime> mealTimes = stats.getMealTimes();
//        double timeVariance = calculateMealTimeVariance(mealTimes);
//        int skippedMeals = stats.getSkippedMeals();
//
//        StringBuilder currentStatus = new StringBuilder();
//        StringBuilder targetStatus = new StringBuilder();
//        StringBuilder improvement = new StringBuilder();
//
//        // 评估用餐时间规律性
//        if (timeVariance > 1.0) { // 用餐时间波动超过1小时
//            currentStatus.append("用餐时间不规律，波动较大；");
//            targetStatus.append("每天在固定时间用餐；");
//            improvement.append("建议保持规律作息，避免过晚用餐；");
//        }
//
//        // 评估��否有漏餐情况
//        if (skippedMeals > 0) {
//            currentStatus.append("存在漏餐现象，平均每周漏餐").append(skippedMeals).append("次；");
//            targetStatus.append("每天三餐按时用餐；");
//            improvement.append("不要因工作繁忙而漏餐，可准备便携零食；");
//        }
//
//        // 评估餐间时间间隔
//        Map<String, Double> mealIntervals = calculateMealIntervals(mealTimes);
//        if (mealIntervals.get("breakfast-lunch") < 3.0 || mealIntervals.get("lunch-dinner") < 4.0) {
//            currentStatus.append("餐间间隔时间过短；");
//            targetStatus.append("保持合理的餐间间隔；");
//            improvement.append("建议早餐和午餐间隔4-5小时，午餐和晚餐间隔5-6小时；");
//        }
//
//        if (currentStatus.length() == 0) {
//            currentStatus.append("用餐时间较为规律");
//            targetStatus.append("保持当前用餐规律");
//            improvement.append("继续保持良好的用餐习惯");
//        }
//
//        advice.setCurrentStatus(currentStatus.toString());
//        advice.setTargetStatus(targetStatus.toString());
//        advice.setImprovementSuggestion(improvement.toString());
//        advice.setExpectedOutcome("规律用餐有助于维持健康的生��钟，促进消化吸收，预防胃肠道疾病");
//
//        return advice;
//    }
//
//    /**
//     * 生成能量分配建议
//     */
//    private DietaryHabitAdvice generateEnergyDistributionAdvice(UserDietStats stats) {
//        DietaryHabitAdvice advice = new DietaryHabitAdvice();
//        advice.setHabitType("能量分配");
//
//        // 分析各餐能量分配
//        double breakfastRatio = stats.getBreakfastCalory() / stats.getTotalCalory();
//        double lunchRatio = stats.getLunchCalory() / stats.getTotalCalory();
//        double dinnerRatio = stats.getDinnerCalory() / stats.getTotalCalory();
//        double snackRatio = stats.getSnackCalory() / stats.getTotalCalory();
//
//        StringBuilder currentStatus = new StringBuilder();
//        StringBuilder targetStatus = new StringBuilder();
//        StringBuilder improvement = new StringBuilder();
//
//        // 评估早餐能量比例 (建议占25-30%)
//        if (breakfastRatio < 0.25) {
//            currentStatus.append("早餐能量摄入不足(").append(String.format("%.1f%%", breakfastRatio * 100)).append(")；");
//            improvement.append("增加早餐的食物量和营养密度；");
//        } else if (breakfastRatio > 0.35) {
//            currentStatus.append("早餐能量摄入过多(").append(String.format("%.1f%%", breakfastRatio * 100)).append(")；");
//            improvement.append("适当减少早餐的食物量；");
//        }
//
//        // 评估午餐能量比例 (建议占30-35%)
//        if (lunchRatio < 0.30) {
//            currentStatus.append("午餐能量摄入不足(").append(String.format("%.1f%%", lunchRatio * 100)).append(")；");
//            improvement.append("适当增加午餐的食物量；");
//        } else if (lunchRatio > 0.40) {
//            currentStatus.append("午餐能量摄入过多(").append(String.format("%.1f%%", lunchRatio * 100)).append(")；");
//            improvement.append("控制午餐的食物量，避免午后犯困；");
//        }
//
//        // 评估晚餐能量比例 (建议占30-35%)
//        if (dinnerRatio > 0.40) {
//            currentStatus.append("晚餐能量摄入过多(").append(String.format("%.1f%%", dinnerRatio * 100)).append(")；");
//            improvement.append("减少晚餐的食物量，避免过晚用餐；");
//        }
//
//        // 评估零食能量比例 (建议不超过10%)
//        if (snackRatio > 0.15) {
//            currentStatus.append("零食能量摄入过多(").append(String.format("%.1f%%", snackRatio * 100)).append(")；");
//            improvement.append("控制零食摄入，选择低热量的健康零食；");
//        }
//
//        targetStatus.append("早餐25-30%，午餐30-35%，晚餐30-35%，零食不超过10%");
//
//        if (currentStatus.length() == 0) {
//            currentStatus.append("各餐能量分配合理");
//            improvement.append("保持当前的能量分配比例");
//        }
//
//        advice.setCurrentStatus(currentStatus.toString());
//        advice.setTargetStatus(targetStatus.toString());
//        advice.setImprovementSuggestion(improvement.toString());
//        advice.setExpectedOutcome("合理的能量分配有助于维持血糖稳定，提供全天能量");
//
//        return advice;
//    }
//
//    /**
//     * 生成饮食多样性建议
//     */
//    private DietaryHabitAdvice generateDietaryDiversityAdvice(UserDietStats stats) {
//        DietaryHabitAdvice advice = new DietaryHabitAdvice();
//        advice.setHabitType("饮食多样性");
//
//        // 分析食物种类多样性
//        Map<String, Integer> foodTypeCount = stats.getFoodTypeCounts();
//        int totalTypes = foodTypeCount.size();
//        double diversityScore = calculateDiversityScore(foodTypeCount);
//
//        StringBuilder currentStatus = new StringBuilder();
//        StringBuilder targetStatus = new StringBuilder();
//        StringBuilder improvement = new StringBuilder();
//
//        // 评估食物种类数量
//        if (totalTypes < 12) { // 建议每天至少12种不同食物
//            currentStatus.append("食物种类较少，仅有").append(totalTypes).append("种；");
//            improvement.append("增加食物种类，每天尝试不同的食材；");
//        }
//
//        // 评估各类食物的比例
//        Map<String, Double> foodTypeRatios = calculateFoodTypeRatios(foodTypeCount);
//        checkFoodTypeBalance(foodTypeRatios, currentStatus, improvement);
//
//        // 评估重复食用情况
//        List<String> frequentFoods = findFrequentFoods(stats);
//        if (!frequentFoods.isEmpty()) {
//            currentStatus.append("存在频繁重复食用的食物：").append(String.join("、", frequentFoods)).append("；");
//            improvement.append("避免频繁食用同样的食物，尝试同类食物的替代选择；");
//        }
//
//        targetStatus.append("每天食用12-15种不同食物，包括谷薯类、蛋白质类、蔬菜水果类、奶制品类等");
//
//        if (currentStatus.length() == 0) {
//            currentStatus.append("饮食多样性良好");
//            improvement.append("继续保持多样化的饮食结构");
//        }
//
//        advice.setCurrentStatus(currentStatus.toString());
//        advice.setTargetStatus(targetStatus.toString());
//        advice.setImprovementSuggestion(improvement.toString());
//        advice.setExpectedOutcome("多样化的饮食有助于获取全面的营养，提高免疫力");
//
//        return advice;
//    }
//
//    /**
//     * 检查营养素严重失衡
//     */
//    private void checkNutrientImbalance(NutritionAnalysis analysis, List<HealthWarning> warnings) {
//        // 检查蛋白质
//        if (analysis.getProteinBalance() < 0.5) {
//            addHealthWarning(warnings, "蛋白质严重不足",
//                "当前蛋白质摄入量远低于推荐量，可能影响机体修复和免疫功能",
//                WarningLevel.SEVERE);
//        }
//
//        // 检查脂肪
//        if (analysis.getFatBalance() > 2.0) {
//            addHealthWarning(warnings, "脂肪摄入过量",
//                "脂肪摄入量显著超标，增加心血管疾病风险",
//                WarningLevel.WARNING);
//        }
//
//        // 检查碳水化合物
//        if (analysis.getCarbBalance() < 0.4) {
//            addHealthWarning(warnings, "碳水化合物严重不足",
//                "碳水化合物摄入不足可能导致能量供应不足，影响日常活动",
//                WarningLevel.WARNING);
//        }
//    }
//
//    /**
//     * 检查营养素缺乏风险
//     */
//    private void checkNutrientDeficiencyRisk(NutritionAnalysis analysis, List<HealthWarning> warnings) {
//        Map<String, Double> vitaminLevels = analysis.getVitaminLevels();
//        Map<String, Double> mineralLevels = analysis.getMineralLevels();
//
//        // 检查维生素缺乏
//        vitaminLevels.forEach((vitamin, level) -> {
//            if (level < 0.6) {
//                String description = String.format("%s摄入量严重不足，仅为推荐量的%.0f%%",
//                    getVitaminName(vitamin), level * 100);
//                addHealthWarning(warnings, vitamin + "缺乏风险", description,
//                    level < 0.3 ? WarningLevel.SEVERE : WarningLevel.WARNING);
//            }
//        });
//
//        // 检查矿物质缺乏
//        mineralLevels.forEach((mineral, level) -> {
//            if (level < 0.6) {
//                String description = String.format("%s摄入量严重不足，仅为推荐量的%.0f%%",
//                    getMineralName(mineral), level * 100);
//                addHealthWarning(warnings, mineral + "缺乏风险", description,
//                    level < 0.3 ? WarningLevel.SEVERE : WarningLevel.WARNING);
//            }
//        });
//    }
//
//    /**
//     * 检查营养素过量风险
//     */
//    private void checkExcessiveIntakeRisk(NutritionAnalysis analysis, List<HealthWarning> warnings) {
//        Map<String, Double> vitaminLevels = analysis.getVitaminLevels();
//        Map<String, Double> mineralLevels = analysis.getMineralLevels();
//
//        // 检查维生素过量
//        vitaminLevels.forEach((vitamin, level) -> {
//            if (level > 2.0) {
//                String description = String.format("%s摄入量过高，为推荐量的%.1f倍",
//                    getVitaminName(vitamin), level);
//                addHealthWarning(warnings, vitamin + "过量风险", description,
//                    level > 3.0 ? WarningLevel.SEVERE : WarningLevel.WARNING);
//            }
//        });
//
//        // 检查矿物质过量
//        mineralLevels.forEach((mineral, level) -> {
//            if (level > 2.0) {
//                String description = String.format("%s摄入量过高，为推荐量的%.1f倍",
//                    getMineralName(mineral), level);
//                addHealthWarning(warnings, mineral + "过量风险", description,
//                    level > 3.0 ? WarningLevel.SEVERE : WarningLevel.WARNING);
//            }
//        });
//    }
//
//    /**
//     * 添加健康警告
//     */
//    private void addHealthWarning(List<HealthWarning> warnings, String type, String description,
//            WarningLevel level) {
//        HealthWarning warning = new HealthWarning();
//        warning.setWarningType(type);
//        warning.setDescription(description);
//        warning.setLevel(level);
//        warning.setRequireMedicalAttention(level == WarningLevel.SEVERE);
//        warning.setSuggestedAction(generateSuggestedAction(type, level));
//        warnings.add(warning);
//    }
//
//    /**
//     * 计算用餐时间方差
//     */
//    private double calculateMealTimeVariance(Map<String, LocalTime> mealTimes) {
//        if (mealTimes == null || mealTimes.isEmpty()) {
//            return 0.0;
//        }
//
//        // 计算每餐的时间偏差
//        Map<String, List<Integer>> timeDeviations = new HashMap<>();
//        mealTimes.forEach((meal, time) -> {
//            int standardHour = getStandardMealHour(meal);
//            int deviation = Math.abs(time.getHour() - standardHour);
//            timeDeviations.computeIfAbsent(meal, k -> new ArrayList<>()).add(deviation);
//        });
//
//        // 计算方差
//        return timeDeviations.values().stream()
//            .mapToDouble(deviations -> {
//                double mean = deviations.stream().mapToInt(Integer::intValue).average().orElse(0.0);
//                double sumSquares = deviations.stream()
//                    .mapToDouble(d -> Math.pow(d - mean, 2))
//                    .sum();
//                return Math.sqrt(sumSquares / deviations.size());
//            })
//            .average()
//            .orElse(0.0);
//    }
//
//    /**
//     * 获取标准用餐时间
//     */
//    private int getStandardMealHour(String meal) {
//        switch (meal.toLowerCase()) {
//            case "breakfast": return 7;
//            case "lunch": return 12;
//            case "dinner": return 18;
//            default: return 0;
//        }
//    }
//
//    /**
//     * 计算餐间时间间隔
//     */
//    private Map<String, Double> calculateMealIntervals(Map<String, LocalTime> mealTimes) {
//        Map<String, Double> intervals = new HashMap<>();
//        if (mealTimes.containsKey("breakfast") && mealTimes.containsKey("lunch")) {
//            intervals.put("breakfast-lunch",
//                calculateHoursBetween(mealTimes.get("breakfast"), mealTimes.get("lunch")));
//        }
//        if (mealTimes.containsKey("lunch") && mealTimes.containsKey("dinner")) {
//            intervals.put("lunch-dinner",
//                calculateHoursBetween(mealTimes.get("lunch"), mealTimes.get("dinner")));
//        }
//        return intervals;
//    }
//
//    /**
//     * 计算两个时间点之间的小时数
//     */
//    private double calculateHoursBetween(LocalTime time1, LocalTime time2) {
//        long minutes = java.time.Duration.between(time1, time2).toMinutes();
//        return minutes / 60.0;
//    }
//
//    /**
//     * 计算食物多样性评分
//     */
//    private double calculateDiversityScore(Map<String, Integer> foodTypeCounts) {
//        if (foodTypeCounts == null || foodTypeCounts.isEmpty()) {
//            return 0.0;
//        }
//
//        // 计算Shannon多样性指数
//        int totalCount = foodTypeCounts.values().stream().mapToInt(Integer::intValue).sum();
//        return foodTypeCounts.values().stream()
//            .mapToDouble(count -> {
//                double proportion = count.doubleValue() / totalCount;
//                return -proportion * Math.log(proportion);
//            })
//            .sum();
//    }
//
//    /**
//     * 计算食物类型比例
//     */
//    private Map<String, Double> calculateFoodTypeRatios(Map<String, Integer> foodTypeCounts) {
//        int totalCount = foodTypeCounts.values().stream().mapToInt(Integer::intValue).sum();
//        Map<String, Double> ratios = new HashMap<>();
//        foodTypeCounts.forEach((type, count) ->
//            ratios.put(type, count.doubleValue() / totalCount));
//        return ratios;
//    }
//
//    /**
//     * 检查食物类型平衡
//     */
//    private void checkFoodTypeBalance(Map<String, Double> ratios,
//            StringBuilder status, StringBuilder improvement) {
//        // 检查谷物类比例 (建议25-30%)
//        double grainRatio = ratios.getOrDefault("grains", 0.0);
//        if (grainRatio < 0.25) {
//            status.append("谷物类食物比例过低；");
//            improvement.append("适当增加谷物类食物的摄入；");
//        } else if (grainRatio > 0.35) {
//            status.append("谷物类食物比例过高；");
//            improvement.append("减少精制谷物，增加其他类别食物；");
//        }
//
//        // 检查蛋白质类比例 (建议20-25%)
//        double proteinRatio = ratios.getOrDefault("protein", 0.0);
//        if (proteinRatio < 0.20) {
//            status.append("蛋白质类食物比例过低；");
//            improvement.append("增加优质蛋白食物的摄入；");
//        } else if (proteinRatio > 0.30) {
//            status.append("蛋白质类食物比例过高；");
//            improvement.append("适当减少肉类摄入，增加植物性食物；");
//        }
//
//        // 检查蔬菜水果比例 (建议40-50%)
//        double vegFruitRatio = ratios.getOrDefault("vegetables", 0.0) +
//                              ratios.getOrDefault("fruits", 0.0);
//        if (vegFruitRatio < 0.40) {
//            status.append("蔬菜水果比例过低；");
//            improvement.append("显著增加蔬菜水果的摄入量；");
//        }
//    }
//
//    /**
//     * 查找频繁食用的食物
//     */
//    private List<String> findFrequentFoods(UserDietStats stats) {
//        Map<String, Integer> foodFrequency = stats.getFoodFrequency();
//        return foodFrequency.entrySet().stream()
//            .filter(entry -> entry.getValue() >= 5) // 一周食用5次以上视为频繁
//            .map(Map.Entry::getKey)
//            .collect(Collectors.toList());
//    }
//
//    /**
//     * 查找高蛋白食物
//     */
//    private List<Food> findHighProteinFoods() {
//        return foodService.findByNutritionCriteria(
//            "protein", 20.0, null,  // 蛋白质含量>20g/100g
//            10,  // 限制返回数量
//            Arrays.asList("meat", "fish", "eggs", "beans")  // 限制食物类别
//        );
//    }
//
//    /**
//     * 查找低蛋白食物
//     */
//    private List<Food> findLowProteinFoods() {
//        return foodService.findByNutritionCriteria(
//            "protein", null, 10.0,  // 蛋白质含量<10g/100g
//            10,
//            Arrays.asList("vegetables", "fruits")
//        );
//    }
//
//    /**
//     * 查找均衡蛋白食物
//     */
//    private List<Food> findBalancedProteinFoods() {
//        return foodService.findByNutritionCriteria(
//            "protein", 10.0, 20.0,  // 蛋白质含量10-20g/100g
//            10,
//            Arrays.asList("meat", "fish", "eggs", "beans", "dairy")
//        );
//    }
//
//    /**
//     * 查找健康脂肪来源
//     */
//    private List<Food> findHealthyFatFoods() {
//        return foodService.findByNutritionCriteria(
//            Arrays.asList(
//                new NutritionCriteria("fat", 20.0, 40.0),
//                new NutritionCriteria("saturated_fat", null, 10.0)
//            ),
//            10,
//            Arrays.asList("nuts", "seeds", "fish")
//        );
//    }
//
//    /**
//     * 查找低脂食物
//     */
//    private List<Food> findLowFatFoods() {
//        return foodService.findByNutritionCriteria(
//            "fat", null, 5.0,  // 脂肪含量<5g/100g
//            10,
//            Arrays.asList("vegetables", "fruits", "lean_meat")
//        );
//    }
//
//    /**
//     * 查找复合碳水化合物食物
//     */
//    private List<Food> findComplexCarbFoods() {
//        return foodService.findByNutritionCriteria(
//            Arrays.asList(
//                new NutritionCriteria("carbohydrate", 40.0, null),
//                new NutritionCriteria("fiber", 5.0, null)
//            ),
//            10,
//            Arrays.asList("whole_grains", "tubers")
//        );
//    }
//
//    /**
//     * 查找高纤维食物
//     */
//    private List<Food> findHighFiberFoods() {
//        return foodService.findByNutritionCriteria(
//            "fiber", 5.0, null,  // 膳食纤维>5g/100g
//            10,
//            Arrays.asList("vegetables", "fruits", "whole_grains")
//        );
//    }
//
//    /**
//     * 查找富含特定维生素的食物
//     */
//    private List<Food> findVitaminRichFoods(List<String> vitamins) {
//        List<NutritionCriteria> criteria = vitamins.stream()
//            .map(v -> new NutritionCriteria(v, getReferenceValue(v) * 0.3, null))
//            .collect(Collectors.toList());
//
//        return foodService.findByNutritionCriteria(criteria, 10, null);
//    }
//
//    /**
//     * 查找富含特定矿物质的食物
//     */
//    private List<Food> findMineralRichFoods(String mineral) {
//        return foodService.findByNutritionCriteria(
//            mineral, getReferenceValue(mineral) * 0.3, null,
//            10,
//            getFoodCategoriesForMineral(mineral)
//        );
//    }
//
//    /**
//     * 获取营养素参考值
//     */
//    private double getReferenceValue(String nutrient) {
//        Map<String, Double> referenceValues = new HashMap<>();
//        referenceValues.put("vitamin_a", 800.0);  // μg
//        referenceValues.put("vitamin_c", 100.0);  // mg
//        referenceValues.put("vitamin_d", 10.0);   // μg
//        referenceValues.put("vitamin_e", 14.0);   // mg
//        referenceValues.put("calcium", 800.0);    // mg
//        referenceValues.put("iron", 12.0);        // mg
//        referenceValues.put("zinc", 12.0);        // mg
//
//        return referenceValues.getOrDefault(nutrient, 0.0);
//    }
//
//    /**
//     * 获取维生素名称
//     */
//    private String getVitaminName(String code) {
//        Map<String, String> names = new HashMap<>();
//        names.put("vitamin_a", "维生素A");
//        names.put("vitamin_b1", "维生素B1");
//        names.put("vitamin_b2", "维生素B2");
//        names.put("vitamin_c", "维生素C");
//        names.put("vitamin_d", "维生素D");
//        names.put("vitamin_e", "维生素E");
//
//        return names.getOrDefault(code, code);
//    }
//
//    /**
//     * 获取矿物质名称
//     */
//    private String getMineralName(String code) {
//        Map<String, String> names = new HashMap<>();
//        names.put("calcium", "钙");
//        names.put("iron", "铁");
//        names.put("zinc", "锌");
//        names.put("selenium", "硒");
//        names.put("potassium", "钾");
//
//        return names.getOrDefault(code, code);
//    }
//
//    /**
//     * 生成建议措施
//     */
//    private String generateSuggestedAction(String type, WarningLevel level) {
//        StringBuilder action = new StringBuilder();
//
//        switch (level) {
//            case SEVERE:
//                action.append("建议尽快就医检查，");
//                break;
//            case WARNING:
//                action.append("建议调整饮食结构，");
//                break;
//            case INFO:
//                action.append("建议关注并改善，");
//                break;
//        }
//
//        // 根据具体问题类型添加建议
//        if (type.contains("缺乏")) {
//            action.append("增加相关食物的摄入，必要时考虑补充剂，定期监测营养状况。");
//        } else if (type.contains("过量")) {
//            action.append("减少相关食物的摄入，避免过度补充，注意观察身体反应。");
//        } else {
//            action.append("保持均衡饮食，规律作息，适量运动。");
//        }
//
//        return action.toString();
//    }
//
//    /**
//     * 计算总体评分
//     */
//    private double calculateOverallScore(NutritionAnalysis analysis) {
//        // 基础分数
//        double baseScore = 70.0;
//
//        // 营养素平衡评分 (最高加减15分)
//        double nutritionBalance = calculateNutritionBalanceScore(analysis);
//
//        // 食物多样性评分 (最高加减10分)
//        double diversity = calculateFoodDiversityScore(analysis);
//
//        // 饮食习惯评分 (最高加减5分)
//        double habits = calculateDietaryHabitsScore(analysis);
//
//        return Math.min(100.0, Math.max(0.0, baseScore + nutritionBalance + diversity + habits));
//    }
//
//    /**
//     * 计算营养素平衡评分
//     */
//    private double calculateNutritionBalanceScore(NutritionAnalysis analysis) {
//        double score = 0.0;
//
//        // 1. 三大营养素比例评分 (最高5分)
//        double macroScore = calculateMacroNutrientScore(
//            analysis.getProteinRatio(),
//            analysis.getFatRatio(),
//            analysis.getCarbRatio()
//        );
//        score += macroScore * 5.0;
//
//        // 2. 维生素达标评分 (最高5分)
//        double vitaminScore = analysis.getVitaminLevels().values().stream()
//            .mapToDouble(level -> calculateNutrientScore(level))
//            .average()
//            .orElse(0.0);
//        score += vitaminScore * 5.0;
//
//        // 3. 矿物质达标评分 (最高5分)
//        double mineralScore = analysis.getMineralLevels().values().stream()
//            .mapToDouble(level -> calculateNutrientScore(level))
//            .average()
//            .orElse(0.0);
//        score += mineralScore * 5.0;
//
//        return score;
//    }
//
//    /**
//     * 计算三大营养素比例评分
//     */
//    private double calculateMacroNutrientScore(double proteinRatio, double fatRatio, double carbRatio) {
//        // 理想比例：蛋白质12-17%，脂肪20-30%，碳水化合物53-68%
//        double score = 1.0;
//
//        // 蛋白质评分
//        if (proteinRatio < 0.12) {
//            score *= (proteinRatio / 0.12);
//        } else if (proteinRatio > 0.17) {
//            score *= (0.17 / proteinRatio);
//        }
//
//        // 脂肪评分
//        if (fatRatio < 0.20) {
//            score *= (fatRatio / 0.20);
//        } else if (fatRatio > 0.30) {
//            score *= (0.30 / fatRatio);
//        }
//
//        // 碳水化合物评分
//        if (carbRatio < 0.53) {
//            score *= (carbRatio / 0.53);
//        } else if (carbRatio > 0.68) {
//            score *= (0.68 / carbRatio);
//        }
//
//        return score;
//    }
//
//    /**
//     * 计算单个营养素达标评分
//     */
//    private double calculateNutrientScore(double level) {
//        if (level < 0.6) {
//            return level / 0.6;  // 不足60%按比例得分
//        } else if (level > 2.0) {
//            return 2.0 / level;  // 超过200%按比例扣分
//        } else {
//            return 1.0;  // 在合理范围内得满分
//        }
//    }
//
//    /**
//     * 计算食物多样性评分
//     */
//    private double calculateFoodDiversityScore(NutritionAnalysis analysis) {
//        double score = 0.0;
//
//        // 1. 食物种类数量评分 (最高4分)
//        int foodTypes = analysis.getFoodTypeCounts().size();
//        score += Math.min(foodTypes / 15.0, 1.0) * 4.0;
//
//        // 2. 食物类别均衡性评分 (最高4分)
//        double balanceScore = calculateFoodTypeBalanceScore(analysis.getFoodTypeRatios());
//        score += balanceScore * 4.0;
//
//        // 3. 食物重复度评分 (最高2分)
//        double repetitionScore = calculateFoodRepetitionScore(analysis.getFoodFrequency());
//        score += repetitionScore * 2.0;
//
//        return score;
//    }
//
//    /**
//     * 计算食物类别均衡性评分
//     */
//    private double calculateFoodTypeBalanceScore(Map<String, Double> ratios) {
//        // 理想比例
//        Map<String, Double> idealRatios = new HashMap<>();
//        idealRatios.put("grains", 0.25);
//        idealRatios.put("protein", 0.20);
//        idealRatios.put("vegetables", 0.35);
//        idealRatios.put("fruits", 0.15);
//        idealRatios.put("dairy", 0.05);
//
//        // 计算与理想比例的偏差
//        return idealRatios.entrySet().stream()
//            .mapToDouble(entry -> {
//                double actual = ratios.getOrDefault(entry.getKey(), 0.0);
//                double ideal = entry.getValue();
//                return 1.0 - Math.abs(actual - ideal) / ideal;
//            })
//            .average()
//            .orElse(0.0);
//    }
//
//    /**
//     * 计算食物重复度评分
//     */
//    private double calculateFoodRepetitionScore(Map<String, Integer> frequency) {
//        // 统计高频食物比例
//        long highFreqCount = frequency.values().stream()
//            .filter(count -> count > 4)  // 一周食用超过4次视为高频
//            .count();
//
//        // 高频食物越少得分越高
//        return Math.max(0.0, 1.0 - (highFreqCount / 10.0));
//    }
//
//    /**
//     * 计算饮食习惯评分
//     */
//    private double calculateDietaryHabitsScore(NutritionAnalysis analysis) {
//        double score = 0.0;
//
//        // 1. 餐次规律性评分 (最高2分)
//        double regularityScore = calculateMealRegularityScore(analysis.getMealTimes());
//        score += regularityScore * 2.0;
//
//        // 2. 能量分配评分 (最高2分)
//        double distributionScore = calculateEnergyDistributionScore(
//            analysis.getMealEnergyRatios());
//        score += distributionScore * 2.0;
//
//        // 3. 进餐时间评分 (最高1分)
//        double timingScore = calculateMealTimingScore(analysis.getMealTimes());
//        score += timingScore;
//
//        return score;
//    }
//
//    /**
//     * 计算餐次规律性评分
//     */
//    private double calculateMealRegularityScore(Map<String, List<LocalTime>> mealTimes) {
//        // 检查三餐是否规律
//        boolean hasBreakfast = mealTimes.containsKey("breakfast") && !mealTimes.get("breakfast").isEmpty();
//        boolean hasLunch = mealTimes.containsKey("lunch") && !mealTimes.get("lunch").isEmpty();
//        boolean hasDinner = mealTimes.containsKey("dinner") && !mealTimes.get("dinner").isEmpty();
//
//        // 基础分：有一餐得0.2分，有两餐得0.5分，三餐都有得1分
//        int mealCount = (hasBreakfast ? 1 : 0) + (hasLunch ? 1 : 0) + (hasDinner ? 1 : 0);
//        double baseScore = mealCount == 3 ? 1.0 : (mealCount == 2 ? 0.5 : (mealCount == 1 ? 0.2 : 0.0));
//
//        // 时间规律性加分
//        double timeVariance = calculateMealTimeVariance(mealTimes);
//        double regularityBonus = Math.max(0.0, 1.0 - timeVariance / 2.0);
//
//        return baseScore * regularityBonus;
//    }
//
//    /**
//     * 计算能量分配评分
//     */
//    private double calculateEnergyDistributionScore(Map<String, Double> ratios) {
//        // 理想比例
//        Map<String, double[]> idealRanges = new HashMap<>();
//        idealRanges.put("breakfast", new double[]{0.25, 0.30});
//        idealRanges.put("lunch", new double[]{0.30, 0.35});
//        idealRanges.put("dinner", new double[]{0.30, 0.35});
//        idealRanges.put("snacks", new double[]{0.05, 0.10});
//
//        return idealRanges.entrySet().stream()
//            .mapToDouble(entry -> {
//                double ratio = ratios.getOrDefault(entry.getKey(), 0.0);
//                double[] range = entry.getValue();
//                if (ratio < range[0]) {
//                    return ratio / range[0];
//                } else if (ratio > range[1]) {
//                    return range[1] / ratio;
//                } else {
//                    return 1.0;
//                }
//            })
//            .average()
//            .orElse(0.0);
//    }
//
//    /**
//     * 计算进餐时间评分
//     */
//    private double calculateMealTimingScore(Map<String, List<LocalTime>> mealTimes) {
//        // 理想用餐时间范围（小时）
//        Map<String, int[]> idealTimeRanges = new HashMap<>();
//        idealTimeRanges.put("breakfast", new int[]{6, 9});
//        idealTimeRanges.put("lunch", new int[]{11, 14});
//        idealTimeRanges.put("dinner", new int[]{17, 20});
//
//        return idealTimeRanges.entrySet().stream()
//            .filter(entry -> mealTimes.containsKey(entry.getKey()))
//            .mapToDouble(entry -> {
//                List<LocalTime> times = mealTimes.get(entry.getKey());
//                int[] range = entry.getValue();
//                return times.stream()
//                    .mapToDouble(time -> {
//                        int hour = time.getHour();
//                        if (hour < range[0]) {
//                            return (double)hour / range[0];
//                        } else if (hour > range[1]) {
//                            return (double)range[1] / hour;
//                        } else {
//                            return 1.0;
//                        }
//                    })
//                    .average()
//                    .orElse(0.0);
//            })
//            .average()
//            .orElse(0.0);
//    }
//}