package com.foodrecord.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;


@Configuration
@ConfigurationProperties(prefix = "ffmpeg")
public class FFmpegConfig {
    
    private String ffmpegPath;
    private String ffprobePath;
    private String outputPath;
    private String thumbnailPath;
    
    // 视频处理相关配置
    private Integer maxDuration; // 最大视频时长(秒)
    private String defaultVideoCodec; // 默认视频编码
    private String defaultAudioCodec; // 默认音频编码
    private String defaultResolution; // 默认分辨率

    public String getFfmpegPath() {
        return ffmpegPath;
    }

    public void setFfmpegPath(String ffmpegPath) {
        this.ffmpegPath = ffmpegPath;
    }

    public String getFfprobePath() {
        return ffprobePath;
    }

    public void setFfprobePath(String ffprobePath) {
        this.ffprobePath = ffprobePath;
    }

    public String getOutputPath() {
        return outputPath;
    }

    public void setOutputPath(String outputPath) {
        this.outputPath = outputPath;
    }

    public String getThumbnailPath() {
        return thumbnailPath;
    }

    public void setThumbnailPath(String thumbnailPath) {
        this.thumbnailPath = thumbnailPath;
    }

    public Integer getMaxDuration() {
        return maxDuration;
    }

    public void setMaxDuration(Integer maxDuration) {
        this.maxDuration = maxDuration;
    }

    public String getDefaultVideoCodec() {
        return defaultVideoCodec;
    }

    public void setDefaultVideoCodec(String defaultVideoCodec) {
        this.defaultVideoCodec = defaultVideoCodec;
    }

    public String getDefaultAudioCodec() {
        return defaultAudioCodec;
    }

    public void setDefaultAudioCodec(String defaultAudioCodec) {
        this.defaultAudioCodec = defaultAudioCodec;
    }

    public String getDefaultResolution() {
        return defaultResolution;
    }

    public void setDefaultResolution(String defaultResolution) {
        this.defaultResolution = defaultResolution;
    }
}