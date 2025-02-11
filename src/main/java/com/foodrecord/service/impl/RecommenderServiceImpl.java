package com.foodrecord.service.impl;

import com.foodrecord.ml.entity.UserFoodInteraction;
import com.foodrecord.service.recommendation.RecommendationStrategy;
//import org.deeplearning4j.util.ModelSerializer;
//import org.deeplearning4j.nn.api.Model;
import com.foodrecord.mapper.FoodMapper;
import com.foodrecord.mapper.UserMapper;
import com.foodrecord.ml.feature.FeatureEngineering;
import com.foodrecord.ml.feature.FoodFeature;
import com.foodrecord.ml.feature.UserFeature;
import com.foodrecord.mapper.RecommenderMapper;
import com.foodrecord.model.entity.Food;
import com.foodrecord.service.RecommenderService;
import com.foodrecord.ml.config.ModelConfig;
//import com.foodrecord.ml.feature.FeatureExtractor;
//import com.foodrecord.ml.model.FoodRecommenderModel;
//import com.foodrecord.ml.data.DataPreprocessor;
//import com.foodrecord.ml.data.MLDataSet;
//import com.foodrecord.ml.evaluation.ModelEvaluator;
//import org.nd4j.linalg.api.ndarray.INDArray;
//import org.nd4j.linalg.factory.Nd4j;
import com.foodrecord.service.UserHealthDataService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import javax.annotation.Resource;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class RecommenderServiceImpl implements RecommenderService, RecommendationStrategy {

//    @Autowired
//    private FoodRecommenderModel model;
//
//    @Autowired
//    private DataPreprocessor dataPreprocessor;
//
//    @Autowired
//    private ModelEvaluator evaluator;
//
//    @Autowired
//    private ModelConfig modelConfig;
//
//    @Resource
//    private FeatureExtractor featureExtractor;

    @Resource
    private FeatureEngineering featureEngineering;

    @Resource
    private RecommenderMapper recommenderMapper;

    @Resource
    private UserMapper userMapper;

    @Resource
    private UserHealthDataService userHealthDataService;

    @Resource
    private FoodMapper foodMapper;

    public static Logger log = LoggerFactory.getLogger(RecommenderServiceImpl.class);


    @Override
    public void trainModel() {
//        // 准备数据
//        MLDataSet dataSet = dataPreprocessor.prepareTrainingData();
//
//        // 数据归一化
//        dataSet.setFeatures(dataPreprocessor.normalize(dataSet.getFeatures()));
//
//        // 分割训练集和验证集
//        MLDataSet[] splits = dataSet.split(modelConfig.getValidationSplit(), true);
//        MLDataSet trainSet = splits[0];
//        MLDataSet validSet = splits[1];
//
//        // 训练模型
//        model.train(trainSet.getFeatures(), trainSet.getLabels());
//
//        // 评估模型
//        Map<String, Double> metrics = evaluator.evaluateModel(
//            model.predict(validSet.getFeatures()),
//            validSet.getLabels()
//        );

//        System.out.println("Training completed. Validation metrics: "+ metrics);
    }

    @Override
    public List<Long> recommendForUser(Long userId, int numRecommendations) {
        try {
            // 获取候选食物列表
            List<Long> candidateFoodIds = recommenderMapper.getAllInteractedFoodIds();

            // 为每个候选食物预测评分
            Map<Long, Double> predictions = new HashMap<>();
            for (Long foodId : candidateFoodIds) {
                double predictedRating = predictRating(userId, foodId);
                predictions.put(foodId, predictedRating);
            }

            // 排序并返回top-N推荐
            return predictions.entrySet().stream()
                    .sorted(Map.Entry.<Long, Double>comparingByValue().reversed())
                    .limit(numRecommendations)
                    .map(Map.Entry::getKey)
                    .collect(Collectors.toList());
        }catch (Exception e){
            e.printStackTrace();
        }
        return null;
    }

    @Override
    public double predictRating(Long userId, Long foodId) {
//        // 提取特征
//        UserFeature userFeature = featureExtractor.extractUserFeature(userMapper.selectById(userId));
//        Food food = foodMapper.selectFoodById(foodId);
//        if (food == null){
//            food = new Food();
//        }
//        FoodFeature foodFeature = featureExtractor.extractFoodFeature(food);
//        // 组合特征
//        double[] combinedFeatures = featureEngineering.combineFeatures(userFeature, foodFeature);
//        System.out.println("combinedFeatures:" + Arrays.toString(combinedFeatures));
//        System.out.println("Feature size: " + combinedFeatures.length);
//        //预测
//        INDArray features = Nd4j.create(combinedFeatures);
//        System.out.println("Feature shape: " + Arrays.toString(features.shape()));
//        INDArray prediction = model.predict(features);
//        return prediction.getDouble(0);
        return 0L;
    }

    @Override
    public void saveModel(String path) {
//        model.save(path);
    }

    @Override
    public void loadModel(String path) {
//        model.load(path);
    }

    @Override
    public List<UserFoodInteraction> getUserFoodInteractions() {
        return recommenderMapper.getAllUserFoodInteractions();
    }

    @Override
    public List<UserFoodInteraction> getFoodInteractionsByUserId(Long userId) {
        return recommenderMapper.getUserInteractions(userId);
    }

    @Override
    public List<Long> getAllInteractedFoodIds() {
        return recommenderMapper.getAllInteractedFoodIds();
    }
}