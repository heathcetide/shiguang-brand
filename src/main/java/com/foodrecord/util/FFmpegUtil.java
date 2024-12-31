package com.foodrecord.util;

import com.foodrecord.config.FFmpegConfig;
import com.foodrecord.controller.user.UserController;
import com.foodrecord.exception.VideoProcessException;
import com.foodrecord.model.vo.VideoInfo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

@Component
public class FFmpegUtil {

    @Resource
    private FFmpegConfig ffmpegConfig;
    private static final Logger logger = LoggerFactory.getLogger(UserController.class);
    /**
     * 执行FFmpeg命令
     */
    public void executeCommand(List<String> command) {
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.redirectErrorStream(true);
            Process process = builder.start();

            // 读取输出
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                logger.debug(line);
            }

            // 等待进程结束
            int exitCode = process.waitFor();
            if (exitCode != 0) {
                throw new VideoProcessException("FFmpeg命令执行失败，退出码：" + exitCode);
            }
        } catch (Exception e) {
            throw new VideoProcessException("FFmpeg命令执行异常：" + e.getMessage());
        }
    }

    /**
     * 获取视频信息
     */
    public VideoInfo getVideoInfo(String videoPath) {
        try {
            List<String> command = new ArrayList<>();
            command.add(ffmpegConfig.getFfprobePath());
            command.add("-v");
            command.add("quiet");
            command.add("-print_format");
            command.add("json");
            command.add("-show_format");
            command.add("-show_streams");
            command.add(videoPath);

            ProcessBuilder builder = new ProcessBuilder(command);
            builder.redirectErrorStream(true);
            Process process = builder.start();

            // 读取输出
            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line);
            }

            // TODO: 解析JSON输出，返回VideoInfo对象
            return new VideoInfo();
        } catch (Exception e) {
            throw new VideoProcessException("获取视频信息失败：" + e.getMessage());
        }
    }

    /**
     * 生成缩略图
     */
    public String generateThumbnail(String videoPath, int position) {
        try {
            String outputPath = ffmpegConfig.getThumbnailPath() + File.separator 
                + System.currentTimeMillis() + ".jpg";

            List<String> command = new ArrayList<>();
            command.add(ffmpegConfig.getFfmpegPath());
            command.add("-i");
            command.add(videoPath);
            command.add("-ss");
            command.add(String.valueOf(position));
            command.add("-vframes");
            command.add("1");
            command.add(outputPath);

            executeCommand(command);
            return outputPath;
        } catch (Exception e) {
            throw new VideoProcessException("生成缩略图失败：" + e.getMessage());
        }
    }
} 