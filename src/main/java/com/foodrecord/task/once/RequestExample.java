package com.foodrecord.task.once;

import cn.hutool.http.HttpRequest;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;

public class RequestExample {
    public static void main(String[] args) {
        // 定义 JSON 文件路径
        String filePath = "G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\codes.json";

        // 使用 Jackson 的 ObjectMapper 解析 JSON 文件
        ObjectMapper objectMapper = new ObjectMapper();
        List<String> codes;
        try {
            // 读取文件并解析为 List<String>
            codes = objectMapper.readValue(new File(filePath), List.class);

            for (String code : codes) {
                try {
                    // 1. 发送 GET 请求获取数据
                    String url = "https://food.boohee.com//fb/v2/foods/" + code + "/detail?token=NatakoYQ6we4cdchwuUzCyGT3gDHm9aB";

                    // 添加请求头，伪造请求来源
                    String result = HttpRequest.get(url)
                            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36")
                            .header("Referer", "https://food.boohee.com")
                            .header("Accept-Language", "en-US,en;q=0.9")
                            .header("X-Forwarded-For", getRandomIp()) // 伪造 IP
                            .execute()
                            .body();

                    // 将响应写入文件
                    File file = new File("G:\\项目实战\\project-6_shiguang-Brand\\shiguang-brand\\src\\main\\java\\com\\foodrecord\\task\\once\\codes.json");
                    try (FileOutputStream fileOutputStream = new FileOutputStream(file)) {
                        fileOutputStream.write(result.getBytes());
                    }

                    // 使用 Jackson 将 JSON 字符串解析为 Map
                    Map<String, Object> response = objectMapper.readValue(result, new TypeReference<>() {});


                    // 添加延迟，防止被服务器封禁
                    Thread.sleep(4000);
                } catch (InterruptedException e) {
                    throw new RuntimeException(e);
                }
            }
        } catch (IOException e) {
            System.err.println("读取 JSON 文件失败: " + e.getMessage());
            e.printStackTrace();
        }
    }

    // 模拟随机 IP
    private static String getRandomIp() {
        int first = (int) (Math.random() * 255);
        int second = (int) (Math.random() * 255);
        int third = (int) (Math.random() * 255);
        int fourth = (int) (Math.random() * 255);
        return first + "." + second + "." + third + "." + fourth;
    }
}
