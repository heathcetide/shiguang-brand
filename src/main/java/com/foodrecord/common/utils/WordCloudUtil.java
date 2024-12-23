package com.foodrecord.common.utils;

import com.kennycason.kumo.CollisionMode;
import com.kennycason.kumo.WordCloud;
import com.kennycason.kumo.WordFrequency;
import com.kennycason.kumo.bg.CircleBackground;
import com.kennycason.kumo.bg.PixelBoundryBackground;
import com.kennycason.kumo.font.FontWeight;
import com.kennycason.kumo.font.KumoFont;
import com.kennycason.kumo.font.scale.LinearFontScalar;
import com.kennycason.kumo.font.scale.SqrtFontScalar;
import com.kennycason.kumo.nlp.FrequencyAnalyzer;
import com.kennycason.kumo.nlp.tokenizers.ChineseWordTokenizer;
import com.kennycason.kumo.palette.ColorPalette;

import java.awt.*;
import java.io.File;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Random;
import java.util.UUID;

/**
 * 生成词云的工具类
 */
public class WordCloudUtil {

    /**
     * 生成词云
     *
     * @param artistId 歌单id
     * @param texts    文本
     */
    public static String generate(String artistId, List<String> texts) {

        FrequencyAnalyzer frequencyAnalyzer = new FrequencyAnalyzer();
        final List<WordFrequency> wordFrequencyList = frequencyAnalyzer.load(texts);
        // 设置图片分辨率大小
        Dimension dimension = new Dimension(600, 600);
        // 生成词云对象
        WordCloud wordCloud = new WordCloud(dimension, CollisionMode.PIXEL_PERFECT);
        // 随机生成0或1
        Random random = new Random();
        Integer num = random.nextInt(1) + 1;

        // 生成随机颜色
        Color randomColor = generateRandomColor();

        if (num.equals(1)) {

            // 设置返回的词数
            frequencyAnalyzer.setWordFrequenciesToReturn(500);
            // 设置返回的词语最小出现频次
            frequencyAnalyzer.setMinWordLength(4);

            // 引入中文解析器
            frequencyAnalyzer.setWordTokenizer(new ChineseWordTokenizer());

            // 设置边界及字体
            wordCloud.setPadding(2);
            // 设置字体，字体必须支持中文，不能随便改
            wordCloud.setKumoFont(new KumoFont("阿里巴巴普惠体 Light", FontWeight.PLAIN));
            // 设置颜色调色板
            wordCloud.setColorPalette(new ColorPalette(randomColor));
            wordCloud.setFontScalar(new SqrtFontScalar(10, 70));

            try {
                // 设置背景图层为圆形
                wordCloud.setBackground(new CircleBackground(300));
                // 生成词云
                wordCloud.build(wordFrequencyList);
                // 输出到图片文件，用当前的毫秒数作为文件名
                Long milliSecond = LocalDateTime.now().toInstant(ZoneOffset.of("+8")).toEpochMilli();
                // 输出到图片文件
                wordCloud.writeToFile("wordCloud-" + artistId + ".png");
                File file = new File("wordCloud-" + artistId + ".png");

                // 将文件上传到 COS
                String filename = UUID.randomUUID().toString() + file.getName();
//                return CosUtils.uploadFile(file, filename);
            } catch (Exception e) {
                e.printStackTrace();
            }
        } else {
            dimension = new Dimension(550, 380);
            // 生成词云对象
            wordCloud = new WordCloud(dimension, CollisionMode.PIXEL_PERFECT);
            frequencyAnalyzer.setWordFrequenciesToReturn(600);
            frequencyAnalyzer.setMinWordLength(4);
            frequencyAnalyzer.setStopWords(texts);
            wordCloud.setPadding(2);

            try {
                wordCloud.setBackground(new PixelBoundryBackground("F:\\项目实战\\project-18_cetide_oj_judge\\cetide-judge-backend\\src\\main\\resources\\background\\whale_small.png"));
                // 设置颜色调色板
                wordCloud.setColorPalette(new ColorPalette(randomColor));
                wordCloud.setFontScalar(new LinearFontScalar(10, 40));
                wordCloud.build(wordFrequencyList);
                wordCloud.writeToFile("wordCloud3-" + artistId + ".png");

                File file = new File("wordCloud3-" + artistId + ".png");

                // 将文件上传到 COS
                String filename = UUID.randomUUID().toString() + file.getName();
//                return CosUtils.uploadFile(file, filename);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        return null;
    }

    /**
     * 生成随机颜色
     *
     * @return 随机颜色
     */
    private static Color generateRandomColor() {
        Random random = new Random();
        int red = random.nextInt(256);
        int green = random.nextInt(256);
        int blue = random.nextInt(256);
        return new Color(red, green, blue);
    }
}
