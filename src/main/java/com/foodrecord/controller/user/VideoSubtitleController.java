package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.service.VideoSubtitleService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;

@Api(tags = "视频字幕接口")
@RestController
@RequestMapping("/api/video/subtitle")
public class VideoSubtitleController {

    @Resource
    private VideoSubtitleService videoSubtitleService;

    @ApiOperation("上传字幕文件")
    @PostMapping("/upload")
    public ApiResponse uploadSubtitle(
            @RequestParam Long videoId,
            @RequestParam String language,
            @RequestParam MultipartFile subtitleFile) {
        return videoSubtitleService.uploadSubtitle(videoId, language, subtitleFile);
    }

    @ApiOperation("自动生成字幕")
    @PostMapping("/generate")
    public ApiResponse generateSubtitle(
            @RequestParam Long videoId,
            @RequestParam String language) {
        return videoSubtitleService.generateSubtitle(videoId, language);
    }

    @ApiOperation("获取视频字幕列表")
    @GetMapping("/list/{videoId}")
    public ApiResponse getSubtitleList(@PathVariable Long videoId) {
        return videoSubtitleService.getSubtitleList(videoId);
    }

    @ApiOperation("获取指定语言的字幕")
    @GetMapping("/{videoId}/{language}")
    public ApiResponse getSubtitle(
            @PathVariable Long videoId,
            @PathVariable String language) {
        return videoSubtitleService.getSubtitle(videoId, language);
    }

    @ApiOperation("删除字幕")
    @DeleteMapping("/{videoId}/{language}")
    public ApiResponse deleteSubtitle(
            @PathVariable Long videoId,
            @PathVariable String language) {
        return videoSubtitleService.deleteSubtitle(videoId, language);
    }
} 