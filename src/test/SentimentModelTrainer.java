package com.foodrecord.model;
import opennlp.tools.doccat.*;
import opennlp.tools.util.InputStreamFactory;
import opennlp.tools.util.ObjectStream;
import opennlp.tools.util.PlainTextByLineStream;
import opennlp.tools.util.TrainingParameters;

import java.io.*;

public class SentimentModelTrainer {

    public static void main(String[] args) {
        String trainingFilePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\model\\sentiment-training.txt"; // 训练数据文件路径
        String modelOutputPath = "sentiment-model.bin";     // 模型保存路径

        try {
            // 加载训练数据
            InputStreamFactory inputStreamFactory = () -> new FileInputStream(trainingFilePath);
            ObjectStream<String> lineStream = new PlainTextByLineStream(inputStreamFactory, "UTF-8");
            ObjectStream<DocumentSample> sampleStream = new DocumentSampleStream(lineStream);

            // 配置训练参数
            TrainingParameters trainingParameters = new TrainingParameters();
            trainingParameters.put(TrainingParameters.ITERATIONS_PARAM, "100"); // 迭代次数
            trainingParameters.put(TrainingParameters.CUTOFF_PARAM, "1");       // 截止频率

            // 使用 DoccatFactory 创建模型
            DoccatModel model = DocumentCategorizerME.train("en", sampleStream, trainingParameters, new DoccatFactory());

            // 保存模型到文件
            try (OutputStream modelOut = new BufferedOutputStream(new FileOutputStream(modelOutputPath))) {
                model.serialize(modelOut);
            }

            System.out.println("模型训练完成，已保存到: " + modelOutputPath);

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
