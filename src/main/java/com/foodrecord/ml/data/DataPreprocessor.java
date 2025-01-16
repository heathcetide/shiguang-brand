// TODO ml - module
//package com.foodrecord.ml.data;
//
//import com.foodrecord.ml.entity.UserFoodInteraction;
//import com.foodrecord.ml.feature.FoodFeature;
//import com.foodrecord.ml.feature.UserFeature;
//import com.foodrecord.mapper.RecommenderMapper;
//import com.foodrecord.model.entity.Food;
//import com.foodrecord.model.entity.user.User;
//import org.springframework.beans.factory.annotation.Qualifier;
//import org.springframework.stereotype.Component;
//import org.nd4j.linalg.api.ndarray.INDArray;
//import org.nd4j.linalg.factory.Nd4j;
//import org.springframework.beans.factory.annotation.Autowired;
//import com.foodrecord.ml.feature.FeatureExtractor;
//
//import javax.annotation.Resource;
//import java.util.ArrayList;
//import java.util.List;
//
//@Component
//public class DataPreprocessor {
//
//    @Resource
//    private RecommenderMapper recommenderMapper;
//
//
//    private static final int USER_FEATURE_DIM = 10; // 根据实际用户特征维度设定
//    private static final int FOOD_FEATURE_DIM = 5; // 根据实际食物特征维度设定
//
//    @Autowired
//    @Qualifier("mlFeatureExtractor")
//    private FeatureExtractor featureExtractor;
//
//    public MLDataSet prepareTrainingData() {
//        MLDataSet dataSet = new MLDataSet();
//
//        // 获取所有用户-食物交互数据
//        List<UserFoodInteraction> interactions = recommenderMapper.getAllUserFoodInteractions();
//        for (UserFoodInteraction interaction : interactions) {
//            User user = new User();
//            user.setUsername(interaction.getRating() + "用户");
//            user.setId(interaction.getId()+2);
//            interaction.setUser(user);
//            Food food = new Food();
//            food.setId(interaction.getId()+1);
//            food.setCode("fd5dccf2");
//            food.setName("全家 咸蛋黄酥松糍饭团");
//            interaction.setFood(food);
//        }
//
//        // 准备特征矩阵
//        int numSamples = interactions.size();
//        int numFeatures = calculateFeatureDimension();
//        INDArray features = Nd4j.zeros(numSamples, numFeatures);
//        INDArray labels = Nd4j.zeros(numSamples, 1);
//
//        for (int i = 0; i < interactions.size(); i++) {
//            UserFoodInteraction interaction = interactions.get(i);
//
//            try {
//                // 提取用户特征
//                UserFeature userFeature = featureExtractor.extractUserFeature(interaction.getUser());
//                if (userFeature == null) {
//                    throw new IllegalStateException("User feature extraction failed for user: " + interaction.getUserId());
//                }
//
//                // 提取食物特征
//                FoodFeature foodFeature = featureExtractor.extractFoodFeature(interaction.getFood());
//                if (foodFeature == null) {
//                    throw new IllegalStateException("Food feature extraction failed for food: " + interaction.getFoodId());
//                }
//
//                // 组合特征
//                double[] combinedFeatures = combineFeatures(userFeature, foodFeature);
//                features.putRow(i, Nd4j.create(combinedFeatures));
//
//                // 设置标签
//                labels.putScalar(i, 0, interaction.getRating());
//            } catch (Exception e) {
//                System.err.println("Error processing interaction at index " + i + ": " + e.getMessage());
//            }
//        }
//
//        dataSet.setFeatures(features);
//        dataSet.setLabels(labels);
//
//        return dataSet;
//    }
//
//    public INDArray normalize(INDArray features) {
//        // 使用Min-Max归一化
//        INDArray min = features.min(0);
//        INDArray max = features.max(0);
//        INDArray range = max.sub(min);
//
//        // 避免除以0
//        range.addi(1e-8);
//
//        return features.sub(min).div(range);
//    }
//
//    private int calculateFeatureDimension() {
//        // 计算特征维度
//        return USER_FEATURE_DIM + FOOD_FEATURE_DIM;
//    }
//
//    private double[] combineFeatures(UserFeature userFeature, FoodFeature foodFeature) {
//        // 组合用户特征和食物特征
//        List<Double> combined = new ArrayList<>();
//        if ((double) userFeature.getAge() == 0){
//            userFeature.setAge(18);
//        }
//        // 添加用户特征
//        combined.add((double) userFeature.getAge());
//        combined.add(userFeature.getGender().equals("M") ? 1.0 : 0.0);
//        combined.add((double) userFeature.getBmi());
//        // ... 添加其他用户特征
//
//        // 添加食物特征
//        combined.add((double) foodFeature.getCalory());
//        combined.add((double) foodFeature.getProtein());
//        combined.add((double) foodFeature.getFat());
//        // ... 添加其他食物特征
//
//        return combined.stream().mapToDouble(Double::doubleValue).toArray();
//    }
//}