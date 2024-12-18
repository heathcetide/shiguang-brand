package com.foodrecord.model.entity;

import opennlp.tools.doccat.DoccatModel;
import opennlp.tools.doccat.DocumentCategorizerME;
import opennlp.tools.util.InputStreamFactory;
import opennlp.tools.util.PlainTextByLineStream;
import java.io.FileInputStream;
import java.io.InputStream;

public class SentimentAnalyzer {
    private DoccatModel model;

    public SentimentAnalyzer(String modelPath) throws Exception {
        // 加载情感分析模型
        try (InputStream is = new FileInputStream(modelPath)) {
            this.model = new DoccatModel(is);
        }
    }

    public String analyzeSentiment(String feedback) {
        // 文本分类器
        DocumentCategorizerME categorizer = new DocumentCategorizerME(model);

        // 对反馈文本进行分词
        String[] tokens = feedback.split("\\s+"); // 简单分词，按空格分隔

        // 分析情感
        double[] outcomes = categorizer.categorize(tokens);
        String category = categorizer.getBestCategory(outcomes);

        return category; // 返回分类结果，如 "positive", "neutral", "negative"
    }

}
