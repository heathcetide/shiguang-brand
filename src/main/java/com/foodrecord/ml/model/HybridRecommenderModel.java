// TODO ml - module
//package com.foodrecord.ml.model;
//
//import com.foodrecord.ml.model.layer.AttentionLayer;
//import com.foodrecord.ml.model.layer.ResidualLayer;
//import com.foodrecord.ml.monitor.TrainingMonitor;
//import org.deeplearning4j.nn.conf.MultiLayerConfiguration;
//import org.deeplearning4j.nn.conf.NeuralNetConfiguration;
//import org.deeplearning4j.nn.conf.layers.*;
//import org.deeplearning4j.nn.multilayer.MultiLayerNetwork;
//import org.deeplearning4j.nn.weights.WeightInit;
//import org.nd4j.linalg.activations.Activation;
//import org.nd4j.linalg.api.ndarray.INDArray;
//import org.nd4j.linalg.learning.config.Adam;
//import org.nd4j.linalg.lossfunctions.LossFunctions;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.stereotype.Component;
//import com.foodrecord.ml.config.ModelConfig;
//
//@Component
//public class HybridRecommenderModel {
//
//    @Autowired
//    private ModelConfig modelConfig;
//
//    private MultiLayerNetwork deepModel;
//
//
//    private CollaborativeFilteringModel cfModel;
//
//    public void initModel(int numInputs) {
//        // 初始化深度学习模型
//        initDeepModel(numInputs);
//        // 初始化协同过滤模型
//        initCFModel();
//    }
//
//    private void initDeepModel(int numInputs) {
//        MultiLayerConfiguration conf = new NeuralNetConfiguration.Builder()
//                .seed(modelConfig.getSeed())
//                .weightInit(WeightInit.XAVIER)
//                .updater(new Adam(modelConfig.getLearningRate()))
//                .list()
//                // 第一层：特征提取
//                .layer(0, new DenseLayer.Builder()
//                        .nIn(numInputs)
//                        .nOut(256)
//                        .activation(Activation.RELU)
//                        .dropOut(modelConfig.getDropoutRate())
//                        .build())
//                // 第二层：特征交叉
//                .layer(1, new DenseLayer.Builder()
//                        .nOut(128)
//                        .activation(Activation.RELU)
//                        .dropOut(modelConfig.getDropoutRate())
//                        .build())
//                // 注意力机制层
//                .layer(2, new AttentionLayer.Builder()
//                        .nIn(128)
//                        .nOut(128)
//                        .build())
//                // 残差连接
//                .layer(3, new ResidualLayer.Builder() // 使用 ResidualLayer 的 Builder
//                        .nIn(128)
//                        .nOut(128)
//                        .build())
//                // 最终预测层
//                .layer(4, new OutputLayer.Builder(LossFunctions.LossFunction.MSE)
//                        .nOut(1)
//                        .activation(Activation.IDENTITY)
//                        .build())
//                .build();
//
//        deepModel = new MultiLayerNetwork(conf);
//        deepModel.init();
//    }
//
//    private void initCFModel() {
//        cfModel = new CollaborativeFilteringModel(
//                modelConfig.getNumFactors(),
//                modelConfig.getLearningRate(),
//                modelConfig.getRegularization()
//        );
//    }
//
//    public void train(INDArray features, INDArray labels, TrainingMonitor monitor) {
//        // 训练深度学习模型
//        deepModel.setListeners(monitor);
//        for (int epoch = 0; epoch < modelConfig.getNumEpochs(); epoch++) {
//            deepModel.fit(features, labels);
//        }
//
//        // 训练协同过滤模型
//        cfModel.train(features, labels);
//    }
//
//    public INDArray predict(INDArray features) {
//        // 获取深度学习模型的预测
//        INDArray deepPredictions = deepModel.output(features);
//
//        // 获取协同过滤模型的预测
//        INDArray cfPredictions = cfModel.predict(features);
//
//        // 组合预测结果（加权平均）
//        return deepPredictions.mul(0.7).add(cfPredictions.mul(0.3));
//    }
//
//}