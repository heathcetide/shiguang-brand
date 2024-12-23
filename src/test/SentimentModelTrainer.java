package com.foodrecord.model;//package com.foodrecord.controller;
import opennlp.tools.doccat.*;
import opennlp.tools.util.InputStreamFactory;
import opennlp.tools.util.ObjectStream;
import opennlp.tools.util.PlainTextByLineStream;
import opennlp.tools.util.TrainingParameters;

import java.io.*;

public class SentimentModelTrainer {

    public static void main(String[] args) {
        String trainingFilePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\resources\\models\\sentiment-training.txt"; // 训练数据文件路径
        String modelOutputPath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\resources\\models\\sentiment-model.bin";     // 模型保存路径

        try {
            // 加载训练数据
            InputStreamFactory inputStreamFactory = () -> new FileInputStream(trainingFilePath);
            ObjectStream<String> lineStream = new PlainTextByLineStream(inputStreamFactory, "UTF-8");
            ObjectStream<DocumentSample> sampleStream = new DocumentSampleStream(lineStream);

            // 配置训练参数
            TrainingParameters trainingParameters = new TrainingParameters();
            trainingParameters.put(TrainingParameters.ITERATIONS_PARAM, "200"); // 迭代次数
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
//import opennlp.tools.doccat.*;
//import opennlp.tools.util.*;
//import org.apache.commons.text.similarity.CosineSimilarity;
//
//import java.io.*;
//import java.util.*;
//import java.util.regex.*;
//
//public class SentimentModelTrainer {
//
//    public static void main(String[] args) {
//        String trainingFilePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\test\\sentiment-training.txt"; // 训练数据文件路径
//        String modelOutputPath = "sentiment-model.bin";     // 模型保存路径
//
//        try {
//            // 加载训练数据
//            InputStreamFactory inputStreamFactory = () -> new FileInputStream(trainingFilePath);
//            ObjectStream<String> lineStream = new PlainTextByLineStream(inputStreamFactory, "UTF-8");
//
//            // 使用 OpenNLP 提供的 DocumentSampleStream 来解析数据
//            ObjectStream<DocumentSample> sampleStream = new DocumentSampleStream(lineStream);
//
//            // 配置训练参数
//            TrainingParameters trainingParameters = new TrainingParameters();
//            trainingParameters.put(TrainingParameters.ITERATIONS_PARAM, "3000"); // 增加迭代次数
//            trainingParameters.put(TrainingParameters.CUTOFF_PARAM, "2");     // 截止频率设置为2
//
//            // 训练模型
//            DoccatModel model = DocumentCategorizerME.train("en", sampleStream, trainingParameters, new DoccatFactory());
//
//            // 保存模型到文件
//            try (OutputStream modelOut = new BufferedOutputStream(new FileOutputStream(modelOutputPath))) {
//                model.serialize(modelOut);
//            }
//
//            System.out.println("模型训练完成，已保存到: " + modelOutputPath);
//
//        } catch (Exception e) {
//            e.printStackTrace();
//        }
//    }
//
//    // 增强的预处理方法：中文分词、停用词去除、情感词典特征等
//    private static String preprocess(String text) {
//        // 1. 中文分词（使用jieba）
//        text = segmentChineseText(text);
//
//        // 2. 转小写
//        text = text.toLowerCase();
//
//        // 3. 移除所有非字母、非数字、非中文字符
//        text = text.replaceAll("[^a-zA-Z0-9\\u4e00-\\u9fa5\\s]", "");
//
//        // 4. 移除停用词
//        text = removeStopWords(text);
//
//        // 5. 提取 N-grams 特征
//        text = extractNgrams(text, 3); // 使用3-grams
//
//        // 6. 加入情感词典特征（通过查找情感词）
//        text = addSentimentFeatures(text);
//
//        // 7. TF-IDF特征提取
//        text = extractTFIDF(text);
//
//        return text;
//    }
//
//    // 中文分词工具：使用jieba进行分词（替换为实际的分词库）
//    private static String segmentChineseText(String text) {
//        // 使用jieba或HanLP进行分词（示例伪代码，实际使用时替换为实际分词工具）
//        // 例如：text = Jieba.segment(text);（伪代码，实际使用时需要使用相应的分词库）
//        return text; // 返回分词后的结果
//    }
//
//    // 停用词移除（使用更完整的停用词列表）
//    private static String removeStopWords(String text) {
//        List<String> stopWords = Arrays.asList("的", "了", "在", "是", "我", "你", "他");
//        for (String stopWord : stopWords) {
//            text = text.replace(" " + stopWord + " ", " ");
//        }
//        return text;
//    }
//
//    // 提取 N-grams 特征（例如3-grams或更高）
//    private static String extractNgrams(String text, int n) {
//        List<String> ngrams = generateNGrams(text, n);
//        return String.join(" ", ngrams);
//    }
//
//    private static List<String> generateNGrams(String text, int n) {
//        List<String> ngrams = new ArrayList<>();
//        String[] tokens = text.split("\\s+");
//        for (int i = 0; i < tokens.length - n + 1; i++) {
//            StringBuilder ngram = new StringBuilder();
//            for (int j = 0; j < n; j++) {
//                ngram.append(tokens[i + j]).append(" ");
//            }
//            ngrams.add(ngram.toString().trim());
//        }
//        return ngrams;
//    }
//
//    // 使用情感词典（例如《知网情感词典》）增强情感分析特征
//    private static String addSentimentFeatures(String text) {
//        List<String> sentimentWords = Arrays.asList("美味", "快速", "好", "差", "难吃");
//        for (String word : sentimentWords) {
//            if (text.contains(word)) {
//                text += " " + word; // 为包含情感词的文本添加额外特征
//            }
//        }
//        return text;
//    }
//
//    // 提取TF-IDF特征
//    private static String extractTFIDF(String text) {
//        // 使用TF-IDF进行词频提取（这里只是简单的展示，你可以替换为实际的TF-IDF计算逻辑）
//        // 假设你已经将文档转换为向量表示，可以通过计算词频来进一步优化特征
//        return text; // 返回添加了TF-IDF特征的文本
//    }
//}


/**
 * 1. 增加更多多样化的训练数据
 * 扩展训练数据：确保训练数据涵盖不同情感表达方式，包括正面、负面、中性等多样化的句子结构和用词。
 * 增加真实用户评论：从你的用户反馈数据中提取样本，丰富训练数据。
 * 数据分布均衡：确保每个类别的样本数量接近，避免分类结果偏向某一类别。
 * 2. 数据清理和预处理
 * 添加数据清理逻辑：
 * 移除标点符号和多余空格。
 * 转换为小写，以减少分词和分类的噪声。
 * 修改训练代码：
 * <p>
 * java
 * 复制代码
 * private static String preprocess(String text) {
 * // 将文本转换为小写，去除多余空格和标点符号
 * return text.toLowerCase().replaceAll("[^a-zA-Z0-9\\u4e00-\\u9fa5\\s]", "").trim();
 * }
 * 将 DocumentSampleStream 替换为：
 * <p>
 * java
 * 复制代码
 * ObjectStream<DocumentSample> sampleStream = new ObjectStream<>() {
 *
 * @Override public DocumentSample read() throws IOException {
 * String line = lineStream.read();
 * if (line == null) return null;
 * <p>
 * // 每行格式：<category>\t<text>
 * String[] parts = line.split("\t", 2);
 * if (parts.length < 2) return null;
 * <p>
 * String category = parts[0];
 * String text = preprocess(parts[1]);
 * return new DocumentSample(category, text.split("\\s+"));
 * }
 * @Override public void reset() throws IOException {
 * lineStream.reset();
 * }
 * @Override public void close() throws IOException {
 * lineStream.close();
 * }
 * };
 * 3. 调整训练参数
 * 修改迭代次数和截止频率：
 * 迭代次数：TrainingParameters.ITERATIONS_PARAM，增加到 200。
 * 截止频率：TrainingParameters.CUTOFF_PARAM，设置为 5，过滤低频特征。
 * 代码：
 * <p>
 * java
 * 复制代码
 * TrainingParameters trainingParameters = new TrainingParameters();
 * trainingParameters.put(TrainingParameters.ITERATIONS_PARAM, "200");
 * trainingParameters.put(TrainingParameters.CUTOFF_PARAM, "5");
 * 4. 使用 N-Gram 特征
 * 默认情况下，模型仅考虑单个词（unigram）。添加 N-Gram（如 bigram 和 trigram）可以提高分类性能。
 * 修改 DoccatFactory 初始化代码：
 * java
 * 复制代码
 * DoccatFactory factory = new DoccatFactory(null, new nGramFeatureGenerator(1, 3));
 * DoccatModel model = DocumentCategorizerME.train("en", sampleStream, trainingParameters, factory);
 * 5. 模型评估
 * 在训练完成后，添加交叉验证或测试集评估逻辑，以衡量模型准确率。
 * <p>
 * 示例代码（添加模型评估）：
 * java
 * 复制代码
 * // 创建一个测试集
 * String testSetPath = "sentiment-test.txt"; // 测试数据路径
 * InputStreamFactory testInputStreamFactory = () -> new FileInputStream(testSetPath);
 * ObjectStream<String> testLineStream = new PlainTextByLineStream(testInputStreamFactory, "UTF-8");
 * ObjectStream<DocumentSample> testSampleStream = new DocumentSampleStream(testLineStream);
 * <p>
 * int correct = 0;
 * int total = 0;
 * DocumentCategorizerME categorizer = new DocumentCategorizerME(model);
 * <p>
 * DocumentSample testSample;
 * while ((testSample = testSampleStream.read()) != null) {
 * String[] tokens = testSample.getText();
 * String expected = testSample.getCategory();
 * String predicted = categorizer.getBestCategory(categorizer.categorize(tokens));
 * <p>
 * if (expected.equals(predicted)) correct++;
 * total++;
 * }
 * <p>
 * System.out.println("模型准确率: " + (correct / (double) total));
 * 6. 训练后的模型优化
 * 增加分词工具支持：
 * 如果处理中文，建议引入分词库（如 HanLP 或 Jieba），提升分词效果。
 * <p>
 * 示例（Jieba 分词）：
 * java
 * 复制代码
 * JiebaSegmenter segmenter = new JiebaSegmenter();
 * List<String> words = segmenter.sentenceProcess(text);
 * String[] tokens = words.toArray(new String[0]);
 * 7. 完整优化后的代码
 * 优化后的训练器：
 * <p>
 * java
 * 复制代码
 * import opennlp.tools.doccat.*;
 * import opennlp.tools.util.InputStreamFactory;
 * import opennlp.tools.util.ObjectStream;
 * import opennlp.tools.util.PlainTextByLineStream;
 * import opennlp.tools.util.TrainingParameters;
 * <p>
 * import java.io.*;
 * <p>
 * public class SentimentModelTrainer {
 * <p>
 * public static void main(String[] args) {
 * String trainingFilePath = "sentiment-training.txt"; // 训练数据文件路径
 * String modelOutputPath = "sentiment-model.bin";     // 模型保存路径
 * <p>
 * try {
 * // 加载训练数据
 * InputStreamFactory inputStreamFactory = () -> new FileInputStream(trainingFilePath);
 * ObjectStream<String> lineStream = new PlainTextByLineStream(inputStreamFactory, "UTF-8");
 * <p>
 * ObjectStream<DocumentSample> sampleStream = new ObjectStream<>() {
 * @Override public DocumentSample read() throws IOException {
 * String line = lineStream.read();
 * if (line == null) return null;
 * <p>
 * String[] parts = line.split("\t", 2);
 * if (parts.length < 2) return null;
 * <p>
 * String category = parts[0];
 * String text = preprocess(parts[1]);
 * return new DocumentSample(category, text.split("\\s+"));
 * }
 * @Override public void reset() throws IOException {
 * lineStream.reset();
 * }
 * @Override public void close() throws IOException {
 * lineStream.close();
 * }
 * };
 * <p>
 * // 配置训练参数
 * TrainingParameters trainingParameters = new TrainingParameters();
 * trainingParameters.put(TrainingParameters.ITERATIONS_PARAM, "200");
 * trainingParameters.put(TrainingParameters.CUTOFF_PARAM, "5");
 * <p>
 * // 训练模型
 * DoccatModel model = DocumentCategorizerME.train("en", sampleStream, trainingParameters, new DoccatFactory());
 * <p>
 * // 保存模型到文件
 * try (OutputStream modelOut = new BufferedOutputStream(new FileOutputStream(modelOutputPath))) {
 * model.serialize(modelOut);
 * }
 * <p>
 * System.out.println("模型训练完成，已保存到: " + modelOutputPath);
 * <p>
 * } catch (Exception e) {
 * e.printStackTrace();
 * }
 * }
 * <p>
 * private static String preprocess(String text) {
 * return text.toLowerCase().replaceAll("[^a-zA-Z0-9\\u4e00-\\u9fa5\\s]", "").trim();
 * }
 * }
 * 优化总结
 * 数据预处理：清理标点、统一大小写、增强分词效果。
 * 参数优化：提高迭代次数、引入 N-Gram 特征。
 * 数据多样化：扩展训练数据，确保类别分布均衡。
 * 模型评估：通过测试集计算准确率，验证模型效果。
 * 性能优化：使用更高效的分词工具。
 * 运行优化后的代码后，你的情感分析模型将更准确、更高效地分类用户反馈。
 */