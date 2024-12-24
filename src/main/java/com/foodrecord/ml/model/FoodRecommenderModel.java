package com.foodrecord.ml.model;

import org.deeplearning4j.nn.conf.MultiLayerConfiguration;
import org.deeplearning4j.nn.multilayer.MultiLayerNetwork;
import org.deeplearning4j.nn.conf.NeuralNetConfiguration;
import org.deeplearning4j.nn.conf.layers.DenseLayer;
import org.deeplearning4j.nn.conf.layers.OutputLayer;
import org.deeplearning4j.nn.weights.WeightInit;
import org.deeplearning4j.util.ModelSerializer;
import org.nd4j.linalg.activations.Activation;
import org.nd4j.linalg.api.ndarray.INDArray;
import org.nd4j.linalg.learning.config.Adam;
import org.nd4j.linalg.lossfunctions.LossFunctions;
import org.springframework.stereotype.Component;
import java.io.IOException;

@Component
public class FoodRecommenderModel {
    private MultiLayerNetwork model;
    
    public void initModel(int numInputs) {
        MultiLayerConfiguration conf = new NeuralNetConfiguration.Builder()
            .seed(123)
            .weightInit(WeightInit.XAVIER)
            .updater(new Adam(0.001))
            .list()
            .layer(0, new DenseLayer.Builder()
                .nIn(numInputs)
                .nOut(128)
                .activation(Activation.RELU)
                .build())
            .layer(1, new DenseLayer.Builder()
                .nOut(64)
                .activation(Activation.RELU)
                .build())
            .layer(2, new OutputLayer.Builder(LossFunctions.LossFunction.MSE)
                .nOut(1)
                .activation(Activation.IDENTITY)
                .build())
            .build();
        
        model = new MultiLayerNetwork(conf);
        model.init();
    }
    
    public void train(INDArray features, INDArray labels) {
        if (model == null) {
            initModel(features.columns());
        }
        
        // 训练模型
        for (int epoch = 0; epoch < 100; epoch++) {
            model.fit(features, labels);
            // 每10个epoch评估一次模型
            if (epoch % 10 == 0) {
                double score = model.score();
                System.out.println("Epoch " + epoch + " Score: " + score);
            }
        }
    }
    
    public INDArray predict(INDArray features) {
        if (model == null) {
            throw new IllegalStateException("Model not initialized");
        }
        return model.output(features);
    }
    
    public void save(String path) {
        try {
            ModelSerializer.writeModel(model, path, true);
        } catch (IOException e) {
            throw new RuntimeException("Error saving model", e);
        }
    }
    
    public void load(String path) {
        try {
            model = ModelSerializer.restoreMultiLayerNetwork(path);
        } catch (IOException e) {
            throw new RuntimeException("Error loading model", e);
        }
    }
    
    public double evaluateModel(INDArray testFeatures, INDArray testLabels) {
        INDArray predictions = predict(testFeatures);
        return calculateRMSE(predictions, testLabels);
    }
    
    private double calculateRMSE(INDArray predictions, INDArray actual) {
        INDArray diff = predictions.sub(actual);
        INDArray squared = diff.mul(diff);
        double mse = squared.meanNumber().doubleValue();
        return Math.sqrt(mse);
    }
}