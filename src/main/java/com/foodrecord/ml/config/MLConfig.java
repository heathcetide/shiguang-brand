// TODO ml - module
//package com.foodrecord.ml.config;
//
//import org.deeplearning4j.nn.conf.MultiLayerConfiguration;
//import org.deeplearning4j.nn.conf.NeuralNetConfiguration;
//import org.deeplearning4j.nn.conf.layers.DenseLayer;
//import org.deeplearning4j.nn.conf.layers.OutputLayer;
//import org.deeplearning4j.nn.multilayer.MultiLayerNetwork;
//import org.deeplearning4j.nn.weights.WeightInit;
//import org.nd4j.linalg.activations.Activation;
//import org.nd4j.linalg.learning.config.Adam;
//import org.nd4j.linalg.lossfunctions.LossFunctions;
//import org.springframework.context.annotation.Configuration;
//import org.springframework.context.annotation.Bean;
//
//@Configuration
//public class MLConfig {
//
//    @Bean
//    public MultiLayerNetwork recommenderNetwork() {
//        // 定义超参数
//        int inputSize = 20; // 输入特征维度
//        int outputSize = 1; // 输出大小（回归问题通常为1）
//        int[] hiddenLayers = {128, 64}; // 隐藏层结构
//        double learningRate = 0.001; // 学习率
//        double dropoutRate = 0.5; // Dropout 概率
//        long seed = 123; // 随机种子
//
//        // 配置神经网络
//        MultiLayerConfiguration conf = new NeuralNetConfiguration.Builder()
//                .seed(seed) // 设置随机种子，保证可重复性
//                .weightInit(WeightInit.XAVIER) // 权重初始化
//                .updater(new Adam(learningRate)) // 使用 Adam 优化器
//                .list() // 定义神经网络的层次结构
//                .layer(0, new DenseLayer.Builder()
//                        .nIn(inputSize) // 输入特征维度
//                        .nOut(hiddenLayers[0]) // 第一隐藏层神经元数量
//                        .activation(Activation.RELU) // 激活函数
//                        .dropOut(dropoutRate) // Dropout 防止过拟合
//                        .build())
//                .layer(1, new DenseLayer.Builder()
//                        .nIn(hiddenLayers[0]) // 上一层输出作为输入
//                        .nOut(hiddenLayers[1]) // 第二隐藏层神经元数量
//                        .activation(Activation.RELU)
//                        .dropOut(dropoutRate)
//                        .build())
//                .layer(2, new OutputLayer.Builder(LossFunctions.LossFunction.MSE) // 输出层，使用均方误差
//                        .nIn(hiddenLayers[1])
//                        .nOut(outputSize) // 输出大小
//                        .activation(Activation.IDENTITY) // 回归任务的激活函数
//                        .build())
//                .build();
//
//        // 初始化网络
//        MultiLayerNetwork network = new MultiLayerNetwork(conf);
//        network.init(); // 初始化权重和参数
//        return network; // 返回配置好的网络
//    }
//}
