package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.service.VideoSubtitleService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;

/**
 * 视频字幕控制器
 * 提供上传、生成、获取和删除视频字幕的功能
 */
@Api(tags = "视频字幕接口")
@RestController
@RequestMapping("/api/video/subtitle")
public class VideoSubtitleController {

    @Resource
    private VideoSubtitleService videoSubtitleService;

    /**
     * 上传字幕文件
     *
     * @param videoId      视频ID
     * @param language     字幕语言
     * @param subtitleFile 字幕文件
     * @return 包含上传结果的ApiResponse对象
     */
    @ApiOperation("上传字幕文件")
    @PostMapping("/upload")
    public ApiResponse uploadSubtitle(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "字幕语言", required = true) @RequestParam String language,
            @ApiParam(value = "字幕文件", required = true) @RequestParam MultipartFile subtitleFile) {
        return videoSubtitleService.uploadSubtitle(videoId, language, subtitleFile);
    }

    /**
     * 自动生成字幕
     *
     * @param videoId  视频ID
     * @param language 字幕语言
     * @return 包含生成结果的ApiResponse对象
     */
    @ApiOperation("自动生成字幕")
    @PostMapping("/generate")
    public ApiResponse generateSubtitle(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "字幕语言", required = true) @RequestParam String language) {
        return videoSubtitleService.generateSubtitle(videoId, language);
    }

    /**
     * 获取视频字幕列表
     *
     * @param videoId 视频ID
     * @return 包含字幕列表的ApiResponse对象
     */
    @ApiOperation("获取视频字幕列表")
    @GetMapping("/list/{videoId}")
    public ApiResponse getSubtitleList(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId) {
        return videoSubtitleService.getSubtitleList(videoId);
    }

    /**
     * 获取指定语言的字幕
     *
     * @param videoId  视频ID
     * @param language 字幕语言
     * @return 包含指定语言字幕的ApiResponse对象
     */
    @ApiOperation("获取指定语言的字幕")
    @GetMapping("/{videoId}/{language}")
    public ApiResponse getSubtitle(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "字幕语言", required = true) @PathVariable String language) {
        return videoSubtitleService.getSubtitle(videoId, language);
    }

    /**
     * 删除字幕
     *
     * @param videoId  视频ID
     * @param language 字幕语言
     * @return 包含删除结果的ApiResponse对象
     */
    @ApiOperation("删除字幕")
    @DeleteMapping("/{videoId}/{language}")
    public ApiResponse deleteSubtitle(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "字幕语言", required = true) @PathVariable String language) {
        return videoSubtitleService.deleteSubtitle(videoId, language);
    }
} 