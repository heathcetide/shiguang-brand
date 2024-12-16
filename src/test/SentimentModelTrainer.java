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

//import opennlp.tools.doccat.*;
//import opennlp.tools.util.InputStreamFactory;
//import opennlp.tools.util.ObjectStream;
//import opennlp.tools.util.PlainTextByLineStream;
//import opennlp.tools.util.TrainingParameters;
//
//import java.io.*;
//
//public class SentimentModelTrainer {
//
//    public static void main(String[] args) {
//        String trainingFilePath = "sentiment-training.txt"; // 训练数据文件路径
//        String modelOutputPath = "sentiment-model.bin";     // 模型保存路径
//
//        try {
//            // 加载训练数据
//            InputStreamFactory inputStreamFactory = () -> new FileInputStream(trainingFilePath);
//            ObjectStream<String> lineStream = new PlainTextByLineStream(inputStreamFactory, "UTF-8");
//
//            ObjectStream<DocumentSample> sampleStream = new ObjectStream<>() {
//                @Override
//                public DocumentSample read() throws IOException {
//                    String line = lineStream.read();
//                    if (line == null) return null;
//
//                    String[] parts = line.split("\t", 2);
//                    if (parts.length < 2) return null;
//
//                    String category = parts[0];
//                    String text = preprocess(parts[1]);
//                    return new DocumentSample(category, text.split("\\s+"));
//                }
//
//                @Override
//                public void reset() throws IOException {
//                    lineStream.reset();
//                }
//
//                @Override
//                public void close() throws IOException {
//                    lineStream.close();
//                }
//            };
//
//            // 配置训练参数
//            TrainingParameters trainingParameters = new TrainingParameters();
//            trainingParameters.put(TrainingParameters.ITERATIONS_PARAM, "200");
//            trainingParameters.put(TrainingParameters.CUTOFF_PARAM, "5");
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
//    private static String preprocess(String text) {
//        return text.toLowerCase().replaceAll("[^a-zA-Z0-9\\u4e00-\\u9fa5\\s]", "").trim();
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
 *
 * java
 * 复制代码
 * private static String preprocess(String text) {
 *     // 将文本转换为小写，去除多余空格和标点符号
 *     return text.toLowerCase().replaceAll("[^a-zA-Z0-9\\u4e00-\\u9fa5\\s]", "").trim();
 * }
 * 将 DocumentSampleStream 替换为：
 *
 * java
 * 复制代码
 * ObjectStream<DocumentSample> sampleStream = new ObjectStream<>() {
 *     @Override
 *     public DocumentSample read() throws IOException {
 *         String line = lineStream.read();
 *         if (line == null) return null;
 *
 *         // 每行格式：<category>\t<text>
 *         String[] parts = line.split("\t", 2);
 *         if (parts.length < 2) return null;
 *
 *         String category = parts[0];
 *         String text = preprocess(parts[1]);
 *         return new DocumentSample(category, text.split("\\s+"));
 *     }
 *
 *     @Override
 *     public void reset() throws IOException {
 *         lineStream.reset();
 *     }
 *
 *     @Override
 *     public void close() throws IOException {
 *         lineStream.close();
 *     }
 * };
 * 3. 调整训练参数
 * 修改迭代次数和截止频率：
 * 迭代次数：TrainingParameters.ITERATIONS_PARAM，增加到 200。
 * 截止频率：TrainingParameters.CUTOFF_PARAM，设置为 5，过滤低频特征。
 * 代码：
 *
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
 *
 * 示例代码（添加模型评估）：
 * java
 * 复制代码
 * // 创建一个测试集
 * String testSetPath = "sentiment-test.txt"; // 测试数据路径
 * InputStreamFactory testInputStreamFactory = () -> new FileInputStream(testSetPath);
 * ObjectStream<String> testLineStream = new PlainTextByLineStream(testInputStreamFactory, "UTF-8");
 * ObjectStream<DocumentSample> testSampleStream = new DocumentSampleStream(testLineStream);
 *
 * int correct = 0;
 * int total = 0;
 * DocumentCategorizerME categorizer = new DocumentCategorizerME(model);
 *
 * DocumentSample testSample;
 * while ((testSample = testSampleStream.read()) != null) {
 *     String[] tokens = testSample.getText();
 *     String expected = testSample.getCategory();
 *     String predicted = categorizer.getBestCategory(categorizer.categorize(tokens));
 *
 *     if (expected.equals(predicted)) correct++;
 *     total++;
 * }
 *
 * System.out.println("模型准确率: " + (correct / (double) total));
 * 6. 训练后的模型优化
 * 增加分词工具支持：
 * 如果处理中文，建议引入分词库（如 HanLP 或 Jieba），提升分词效果。
 *
 * 示例（Jieba 分词）：
 * java
 * 复制代码
 * JiebaSegmenter segmenter = new JiebaSegmenter();
 * List<String> words = segmenter.sentenceProcess(text);
 * String[] tokens = words.toArray(new String[0]);
 * 7. 完整优化后的代码
 * 优化后的训练器：
 *
 * java
 * 复制代码
 * import opennlp.tools.doccat.*;
 * import opennlp.tools.util.InputStreamFactory;
 * import opennlp.tools.util.ObjectStream;
 * import opennlp.tools.util.PlainTextByLineStream;
 * import opennlp.tools.util.TrainingParameters;
 *
 * import java.io.*;
 *
 * public class SentimentModelTrainer {
 *
 *     public static void main(String[] args) {
 *         String trainingFilePath = "sentiment-training.txt"; // 训练数据文件路径
 *         String modelOutputPath = "sentiment-model.bin";     // 模型保存路径
 *
 *         try {
 *             // 加载训练数据
 *             InputStreamFactory inputStreamFactory = () -> new FileInputStream(trainingFilePath);
 *             ObjectStream<String> lineStream = new PlainTextByLineStream(inputStreamFactory, "UTF-8");
 *
 *             ObjectStream<DocumentSample> sampleStream = new ObjectStream<>() {
 *                 @Override
 *                 public DocumentSample read() throws IOException {
 *                     String line = lineStream.read();
 *                     if (line == null) return null;
 *
 *                     String[] parts = line.split("\t", 2);
 *                     if (parts.length < 2) return null;
 *
 *                     String category = parts[0];
 *                     String text = preprocess(parts[1]);
 *                     return new DocumentSample(category, text.split("\\s+"));
 *                 }
 *
 *                 @Override
 *                 public void reset() throws IOException {
 *                     lineStream.reset();
 *                 }
 *
 *                 @Override
 *                 public void close() throws IOException {
 *                     lineStream.close();
 *                 }
 *             };
 *
 *             // 配置训练参数
 *             TrainingParameters trainingParameters = new TrainingParameters();
 *             trainingParameters.put(TrainingParameters.ITERATIONS_PARAM, "200");
 *             trainingParameters.put(TrainingParameters.CUTOFF_PARAM, "5");
 *
 *             // 训练模型
 *             DoccatModel model = DocumentCategorizerME.train("en", sampleStream, trainingParameters, new DoccatFactory());
 *
 *             // 保存模型到文件
 *             try (OutputStream modelOut = new BufferedOutputStream(new FileOutputStream(modelOutputPath))) {
 *                 model.serialize(modelOut);
 *             }
 *
 *             System.out.println("模型训练完成，已保存到: " + modelOutputPath);
 *
 *         } catch (Exception e) {
 *             e.printStackTrace();
 *         }
 *     }
 *
 *     private static String preprocess(String text) {
 *         return text.toLowerCase().replaceAll("[^a-zA-Z0-9\\u4e00-\\u9fa5\\s]", "").trim();
 *     }
 * }
 * 优化总结
 * 数据预处理：清理标点、统一大小写、增强分词效果。
 * 参数优化：提高迭代次数、引入 N-Gram 特征。
 * 数据多样化：扩展训练数据，确保类别分布均衡。
 * 模型评估：通过测试集计算准确率，验证模型效果。
 * 性能优化：使用更高效的分词工具。
 * 运行优化后的代码后，你的情感分析模型将更准确、更高效地分类用户反馈。
 */