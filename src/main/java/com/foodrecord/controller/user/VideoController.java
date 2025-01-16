package com.foodrecord.controller.user;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.video.VideoComments;
import com.foodrecord.model.entity.video.Videos;
import com.foodrecord.service.*;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.google.common.util.concurrent.RateLimiter;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import io.swagger.models.auth.In;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/video")
@Api(tags = "视频接口")
public class VideoController {

    @Resource
    private VideosService videosService;
    
    @Resource
    private VideoCommentsService videoCommentsService;
    
    @Resource
    private VideoLikesService videoLikesService;
    
    @Resource
    private VideoFavoritesService videoFavoritesService;
    
    @Resource
    private VideoTagsService videoTagsService;
    
    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    @Resource
    private VideoAuditService videoAuditService;

    @Resource
    private VideoTranscodeService videoTranscodeService;

    @Resource
    private VideoStatisticsService videoStatisticsService;

    @Resource
    private VideoHistoryService videoHistoryService;

    @Resource
    private VideoReportService videoReportService;

    @Resource
    private VideoDanmakuService videoDanmakuService;

    @Resource
    private VideoQualityService videoQualityService;

    @Resource
    private VideoWatermarkService videoWatermarkService;

    @Resource
    private VideoShareService videoShareService;

    @Resource
    private VideoDownloadService videoDownloadService;

    @Resource
    private VideoLiveService videoLiveService;

    @Resource
    private VideoMusicService videoMusicService;

    @Resource
    private VideoEditService videoEditService;

    // 限流器配置
    private final RateLimiter rateLimiter = RateLimiter.create(20.0);

    // 视频缓存
    private final Cache<String, Videos> videoCache = CacheBuilder.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(1000)
            .build();

    private final int CHUNK_SIZE = 1024 * 1024 * 2; // 2MB 分片大小

    /**
     * 上传视频
     *
     * @param file        视频文件
     * @param title       视频标题
     * @param description 视频描述
     * @param userId      用户ID
     * @param tags        视频标签（可选）
     * @return 包含上传结果的ApiResponse对象
     */
    @PostMapping("/upload")
    @ApiOperation(value = "上传视频")
    public ApiResponse uploadVideo(
            @ApiParam(value = "视频文件", required = true) @RequestPart("file") MultipartFile file,
            @ApiParam(value = "视频标题", required = true) @RequestParam("title") String title,
            @ApiParam(value = "视频描述", required = true) @RequestParam("description") String description,
            @ApiParam(value = "用户ID", required = true) @RequestParam("userId") Long userId,
            @ApiParam(value = "视频标签（可选）", required = false) @RequestParam(value = "tags", required = false) List<String> tags) {

        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        return videosService.uploadVideo(file, title, description, userId, tags);
    }

    /**
     * 获取视频详情
     *
     * @param id 视频ID
     * @return 包含视频详情的ApiResponse对象
     */
    @GetMapping("/{id}")
    @ApiOperation(value = "获取视频详情")
    public ApiResponse getVideoDetails(@ApiParam(value = "视频ID", required = true) @PathVariable Long id) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:detail:" + id;
            Map<String, Object> videoDetails = (Map<String, Object>) redisTemplate.opsForValue().get(cacheKey);

            if (videoDetails != null) {
                return ApiResponse.success(videoDetails);
            }

            ApiResponse<Map<String, Object>> result = videosService.getVideoDetails(id);
            if (result != null && result.getData() != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return ApiResponse.success(result.getData());
        }).join();
    }

    /**
     * 发表评论
     *
     * @param comment 评论对象
     * @return 包含评论结果的ApiResponse对象
     */
    @PostMapping("/comment")
    @ApiOperation(value = "发表评论")
    public ApiResponse addComment(@ApiParam(value = "评论对象", required = true) @RequestBody VideoComments comment) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        comment.setCreatedAt(new Date());
        comment.setUpdatedAt(new Date());
        return videoCommentsService.addComment(comment);
    }

    /**
     * 获取视频评论
     *
     * @param videoId 视频ID
     * @param pageNum 页码
     * @param pageSize 每页大小
     * @return 包含视频评论的ApiResponse对象
     */
    @GetMapping("/comments/{videoId}")
    @ApiOperation(value = "获取视频评论")
    public ApiResponse getVideoComments(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "20") @RequestParam(defaultValue = "20") Integer pageSize) {

        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:comments:" + videoId + ":" + pageNum + ":" + pageSize;
            List<Map<String, Object>> comments = (List<Map<String, Object>>) redisTemplate.opsForValue().get(cacheKey);

            if (comments != null) {
                return ApiResponse.success(comments);
            }

            ApiResponse<List<Map<String, Object>>> result = videoCommentsService.getVideoComments(videoId, pageNum, pageSize);
            if (result != null && result.getData() != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return ApiResponse.success(result.getData());
        }).join();
    }

    /**
     * 点赞视频
     *
     * @param videoId 视频ID
     * @param userId  用户ID
     * @return 包含点赞结果的ApiResponse对象
     */
    @PostMapping("/like/{videoId}")
    @ApiOperation(value = "点赞视频")
    public ApiResponse likeVideo(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {

        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        return videoLikesService.likeVideo(videoId, userId);
    }

    /**
     * 取消点赞
     *
     * @param videoId 视频ID
     * @param userId  用户ID
     * @return 包含取消点赞结果的ApiResponse对象
     */
    @DeleteMapping("/unlike/{videoId}")
    @ApiOperation(value = "取消点赞")
    public ApiResponse unlikeVideo(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {

        return videoLikesService.unlikeVideo(videoId, userId);
    }

    /**
     * 收藏视频
     *
     * @param videoId 视频ID
     * @param userId  用户ID
     * @return 包含收藏结果的ApiResponse对象
     */
    @PostMapping("/favorite/{videoId}")
    @ApiOperation(value = "收藏视频")
    public ApiResponse favoriteVideo(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {

        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        return videoFavoritesService.favoriteVideo(videoId, userId);
    }

    /**
     * 取消收藏
     *
     * @param videoId 视频ID
     * @param userId  用户ID
     * @return 包含取消收藏结果的ApiResponse对象
     */
    @DeleteMapping("/unfavorite/{videoId}")
    @ApiOperation(value = "取消收藏")
    public ApiResponse unfavoriteVideo(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {

        return videoFavoritesService.unfavoriteVideo(videoId, userId);
    }


    /**
     * 搜索视频
     *
     * @param keyword  关键字
     * @param pageNum  页码
     * @param pageSize 每页大小
     * @return 包含搜索结果的ApiResponse对象
     */
    @GetMapping("/search")
    @ApiOperation(value = "搜索视频")
    public ApiResponse searchVideos(
            @ApiParam(value = "关键字", required = true) @RequestParam String keyword,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {

        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        return videosService.searchVideos(keyword, pageNum, pageSize);
    }

    /**
     * 根据标签获取视频
     *
     * @param tag      标签
     * @param pageNum  页码
     * @param pageSize 每页大小
     * @return 包含视频列表的ApiResponse对象
     */
    @GetMapping("/byTag/{tag}")
    @ApiOperation(value = "根据标签获取视频")
    public ApiResponse getVideosByTag(
            @ApiParam(value = "标签", required = true) @PathVariable String tag,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {

        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:tag:" + tag + ":" + pageNum;
            List<Videos> videos = (List<Videos>) redisTemplate.opsForValue().get(cacheKey);

            if (videos != null) {
                return ApiResponse.success(videos);
            }

            ApiResponse result = videosService.getVideosByTag(tag, pageNum, pageSize);
            if (result != null && result.getData() != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return result;
        }).join();
    }

    /**
     * 获取用户发布的视频
     *
     * @param userId   用户ID
     * @param pageNum  页码
     * @param pageSize 每页大小
     * @return 包含用户视频列表的ApiResponse对象
     */
    @GetMapping("/user/{userId}")
    @ApiOperation(value = "获取用户发布的视频")
    public ApiResponse getUserVideos(
            @ApiParam(value = "用户ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {

        return videosService.getUserVideos(userId, pageNum, pageSize);
    }

    /**
     * 删除视频
     *
     * @param id     视频ID
     * @param userId 用户ID
     * @return 包含删除结果的ApiResponse对象
     */
    @DeleteMapping("/{id}")
    @ApiOperation(value = "删除视频")
    public ApiResponse deleteVideo(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long id,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {

        return videosService.deleteVideo(id, userId);
    }

    /**
     * 更新视频信息
     *
     * @param video 视频对象
     * @return 包含更新结果的ApiResponse对象
     */
    @PutMapping("/update")
    @ApiOperation(value = "更新视频信息")
    public ApiResponse updateVideo(@ApiParam(value = "视频对象", required = true) @RequestBody Videos video) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        return videosService.updateVideo(video);
    }

    /**
     * 获取推荐视频
     *
     * @param userId   用户ID（可选）
     * @param pageNum  页码
     * @param pageSize 每页大小
     * @return 包含推荐视频列表的ApiResponse对象
     */
    @GetMapping("/recommend")
    @ApiOperation(value = "获取推荐视频")
    public ApiResponse getRecommendedVideos(
            @ApiParam(value = "用户ID（可选）", required = false) @RequestParam(required = false) Long userId,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {

        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:recommend:" + (userId != null ? userId : "anonymous") + ":" + pageNum;
            List<Videos> videos = (List<Videos>) redisTemplate.opsForValue().get(cacheKey);

            if (videos != null) {
                return ApiResponse.success(videos);
            }

            ApiResponse result = videosService.getRecommendedVideos(userId, pageNum, pageSize);
            if (result != null && result.getData() != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return result;
        }).join();
    }

    /**
     * 获取下一个视频
     *
     * @param lastVideoId 上一个视频ID（可选）
     * @return 包含下一个视频的ApiResponse对象
     */
    @GetMapping("/next")
    @ApiOperation(value = "获取下一个视频")
    public ApiResponse getNextVideo(@ApiParam(value = "上一个视频ID（可选）", required = false) @RequestParam(required = false) Long lastVideoId) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        return CompletableFuture.supplyAsync(() -> {
            try {
                String cacheKey = "video:next:" + (lastVideoId != null ? lastVideoId : "first");
                Map<String, Object> video = (Map<String, Object>) redisTemplate.opsForValue().get(cacheKey);

                if (video != null) {
                    return ApiResponse.success(video);
                }

                ApiResponse result = videosService.getNextVideo(lastVideoId);
                if (result != null && result.getData() != null) {
                    redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
                }
                return result;
            } catch (Exception e) {
                return ApiResponse.error(300, "请求错误: " + e.getMessage());
            }
        }).join();
    }


    /**
     * 分片上传视频
     *
     * @param file        视频文件分片
     * @param chunkNumber 分片编号
     * @param totalChunks 总分片数
     * @param fileId      文件ID
     * @return 包含分片上传结果的ApiResponse对象
     */
    @PostMapping("/chunk")
    @ApiOperation(value = "分片上传视频")
    public ApiResponse uploadVideoChunk(
            @ApiParam(value = "视频文件分片", required = true) @RequestParam("file") MultipartFile file,
            @ApiParam(value = "分片编号", required = true) @RequestParam("chunkNumber") Integer chunkNumber,
            @ApiParam(value = "总分片数", required = true) @RequestParam("totalChunks") Integer totalChunks,
            @ApiParam(value = "文件ID", required = true) @RequestParam("fileId") String fileId) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoTranscodeService.uploadChunk(file, chunkNumber, totalChunks, fileId);
    }

    /**
     * 合并视频分片
     *
     * @param fileId      文件ID
     * @param fileName    文件名
     * @param totalChunks 总分片数
     * @return 包含合并结果的ApiResponse对象
     */
    @PostMapping("/merge")
    @ApiOperation(value = "合并视频分片")
    public ApiResponse mergeVideoChunks(
            @ApiParam(value = "文件ID", required = true) @RequestParam("fileId") String fileId,
            @ApiParam(value = "文件名", required = true) @RequestParam("fileName") String fileName,
            @ApiParam(value = "总分片数", required = true) @RequestParam("totalChunks") Integer totalChunks) {
        return videoTranscodeService.mergeChunks(fileId, fileName, totalChunks);
    }

    /**
     * 提交视频审核
     *
     * @param videoId 视频ID
     * @return 包含审核提交结果的ApiResponse对象
     */
    @PostMapping("/audit/submit")
    @ApiOperation(value = "提交视频审核")
    public ApiResponse submitVideoAudit(@ApiParam(value = "视频ID", required = true) @RequestParam Long videoId) {
        return videoAuditService.submitAudit(videoId);
    }
    /**
     * 获取视频审核状态
     *
     * @param videoId 视频ID
     * @return 包含审核状态的ApiResponse对象
     */
    @GetMapping("/audit/status/{videoId}")
    @ApiOperation(value = "获取视频审核状态")
    public ApiResponse getVideoAuditStatus(@ApiParam(value = "视频ID", required = true) @PathVariable Long videoId) {
        return videoAuditService.getAuditStatus(videoId);
    }

    /**
     * 记录视频播放
     *
     * @param videoId      视频ID
     * @param userId       用户ID（可选）
     * @param clientIp     客户端IP地址
     * @return 包含播放记录结果的ApiResponse对象
     */
    @PostMapping("/statistics/play")
    @ApiOperation(value = "记录视频播放")
    public ApiResponse recordVideoPlay(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "用户ID（可选）", required = false) @RequestParam(required = false) Long userId,
            @ApiParam(value = "客户端IP地址", required = true) @RequestParam String clientIp) {
        return videoStatisticsService.recordPlay(videoId, userId, clientIp);
    }

    /**
     * 获取视频统计数据
     *
     * @param videoId 视频ID
     * @return 包含视频统计数据的ApiResponse对象
     */
    @GetMapping("/statistics/{videoId}")
    @ApiOperation(value = "获取视频统计数据")
    public ApiResponse getVideoStatistics(@ApiParam(value = "视频ID", required = true) @PathVariable Long videoId) {
        return videoStatisticsService.getStatistics(videoId);
    }

    /**
     * 添加观看历史
     *
     * @param videoId      视频ID
     * @param userId       用户ID
     * @param watchDuration 观看时长（秒）
     * @return 包含添加历史结果的ApiResponse对象
     */
    @PostMapping("/history/add")
    @ApiOperation(value = "添加观看历史")
    public ApiResponse addVideoHistory(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId,
            @ApiParam(value = "观看时长（秒）", required = true) @RequestParam Integer watchDuration) {
        return videoHistoryService.addHistory(videoId, userId, watchDuration);
    }

    /**
     * 获取用户观看历史
     *
     * @param userId   用户ID
     * @param pageNum  页码
     * @param pageSize 每页大小
     * @return 包含用户观看历史的ApiResponse对象
     */
    @GetMapping("/history/user/{userId}")
    @ApiOperation(value = "获取用户观看历史")
    public ApiResponse getUserVideoHistory(
            @ApiParam(value = "用户ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {
        return videoHistoryService.getUserHistory(userId, pageNum, pageSize);
    }

    /**
     * 举报视频
     *
     * @param videoId     视频ID
     * @param userId      用户ID
     * @param reason      举报原因
     * @param description 举报描述（可选）
     * @return 包含举报结果的ApiResponse对象
     */
    @PostMapping("/report")
    @ApiOperation(value = "举报视频")
    public ApiResponse reportVideo(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId,
            @ApiParam(value = "举报原因", required = true) @RequestParam String reason,
            @ApiParam(value = "举报描述（可选）", required = false) @RequestParam(required = false) String description) {
        return videoReportService.reportVideo(videoId, userId, reason, description);
    }

    /**
     * 查询举报状态
     *
     * @param reportId 举报ID
     * @return 包含举报状态的ApiResponse对象
     */
    @GetMapping("/report/status/{reportId}")
    @ApiOperation(value = "查询举报状态")
    public ApiResponse getReportStatus(@ApiParam(value = "举报ID", required = true) @PathVariable Long reportId) {
        return videoReportService.getReportStatus(reportId);
    }

    /**
     * 获取视频可用清晰度
     *
     * @param videoId 视频ID
     * @return 包含可用清晰度列表的ApiResponse对象
     */
    @GetMapping("/quality/{videoId}")
    @ApiOperation(value = "获取视频可用清晰度")
    public ApiResponse getVideoQualities(@ApiParam(value = "视频ID", required = true) @PathVariable Long videoId) {
        return videoQualityService.getAvailableQualities(videoId);
    }

    /**
     * 获取指定清晰度的视频地址
     *
     * @param videoId 视频ID
     * @param quality 清晰度
     * @return 包含指定清晰度视频地址的ApiResponse对象
     */
    @GetMapping("/quality/{videoId}/{quality}")
    @ApiOperation(value = "获取指定清晰度的视频地址")
    public ApiResponse getVideoUrlByQuality(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "清晰度", required = true) @PathVariable String quality) {
        return videoQualityService.getVideoUrl(videoId, quality);
    }

    /**
     * 添加视频水印
     *
     * @param videoId      视频ID
     * @param watermarkText 水印文本
     * @param position     水印位置（可选）
     * @param opacity      水印透明度（可选）
     * @return 包含添加水印结果的ApiResponse对象
     */
    @PostMapping("/watermark/add")
    @ApiOperation(value = "添加视频水印")
    public ApiResponse addWatermark(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "水印文本", required = true) @RequestParam String watermarkText,
            @ApiParam(value = "水印位置（可选）", required = false) @RequestParam(required = false) String position,
            @ApiParam(value = "水印透明度（可选）", required = false) @RequestParam(required = false) Float opacity) {
        return videoWatermarkService.addWatermark(videoId, watermarkText, position, opacity);
    }

    /**
     * 预览水印效果
     *
     * @param videoId      视频ID
     * @param watermarkText 水印文本
     * @param position     水印位置（可选）
     * @return 包含预览水印结果的ApiResponse对象
     */
    @GetMapping("/watermark/preview/{videoId}")
    @ApiOperation(value = "预览水印效果")
    public ApiResponse previewWatermark(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "水印文本", required = true) @RequestParam String watermarkText,
            @ApiParam(value = "水印位置（可选）", required = false) @RequestParam(required = false) String position) {
        return videoWatermarkService.previewWatermark(videoId, watermarkText, position);
    }

    /**
     * 分享视频
     *
     * @param videoId 视频ID
     * @param userId  用户ID
     * @param platform 分享平台
     * @return 包含分享结果的ApiResponse对象
     */
    @PostMapping("/share")
    @ApiOperation(value = "分享视频")
    public ApiResponse shareVideo(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId,
            @ApiParam(value = "分享平台", required = true) @RequestParam String platform) {
        return videoShareService.shareVideo(videoId, userId, platform);
    }

    /**
     * 获取分享链接
     *
     * @param videoId 视频ID
     * @param platform 分享平台（可选）
     * @return 包含分享链接的ApiResponse对象
     */
    @GetMapping("/share/link/{videoId}")
    @ApiOperation(value = "获取分享链接")
    public ApiResponse getShareLink(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "分享平台（可选）", required = false) @RequestParam(required = false) String platform) {
        return videoShareService.generateShareLink(videoId, 1L, platform);
    }

    /**
     * 获取热门视频
     *
     * @param pageNum   页码
     * @param pageSize  每页大小
     * @param timeRange 时间范围（可选）
     * @return 包含热门视频列表的ApiResponse对象
     */
    @GetMapping("/trending")
    @ApiOperation(value = "获取热门视频")
    public ApiResponse getTrendingVideos(
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize,
            @ApiParam(value = "时间范围（可选）", required = false) @RequestParam(required = false) String timeRange) {
        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:trending:" + timeRange + ":" + pageNum;
            List<Videos> videos = (List<Videos>) redisTemplate.opsForValue().get(cacheKey);

            if (videos != null) {
                return ApiResponse.success(videos);
            }

            ApiResponse result = videosService.getTrendingVideos(pageNum, pageSize, timeRange);
            if (result != null && result.getData() != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return ApiResponse.success(result.getData());
        }).join();
    }

    /**
     * 获取分类热门视频
     *
     * @param category 分类
     * @param pageNum  页码
     * @param pageSize 每页大小
     * @return 包含分类热门视频列表的ApiResponse对象
     */
    @GetMapping("/trending/categories")
    @ApiOperation(value = "获取分类热门视频")
    public ApiResponse getTrendingByCategory(
            @ApiParam(value = "分类", required = true) @RequestParam String category,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {
        return videosService.getTrendingByCategory(category, pageNum, pageSize);
    }

    /**
     * 请求下载视频
     *
     * @param videoId 视频ID
     * @param userId  用户ID
     * @param quality 视频清晰度（可选）
     * @return 包含下载请求结果的ApiResponse对象
     */
    @PostMapping("/download/request")
    @ApiOperation(value = "请求下载视频")
    public ApiResponse requestVideoDownload(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId,
            @ApiParam(value = "视频清晰度（可选）", required = false) @RequestParam(required = false) String quality) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoDownloadService.requestDownload(videoId, userId, quality);
    }

    /**
     * 获取下载链接
     *
     * @param downloadId 下载ID
     * @return 包含下载链接的ApiResponse对象
     */
    @GetMapping("/download/{downloadId}")
    @ApiOperation(value = "获取下载链接")
    public ApiResponse getDownloadUrl(@ApiParam(value = "下载ID", required = true) @PathVariable String downloadId) {
        return videoDownloadService.getDownloadUrl(Long.valueOf(downloadId));
    }

    /**
     * 获取下载进度
     *
     * @param downloadId 下载ID
     * @return 包含下载进度的ApiResponse对象
     */
    @GetMapping("/download/progress/{downloadId}")
    @ApiOperation(value = "获取下载进度")
    public ApiResponse getDownloadProgress(@ApiParam(value = "下载ID", required = true) @PathVariable String downloadId) {
        return videoDownloadService.getDownloadProgress(Long.valueOf(downloadId));
    }

    /**
     * 回复评论
     *
     * @param commentId 评论ID
     * @param userId    用户ID
     * @param content   回复内容
     * @return 包含回复结果的ApiResponse对象
     */
    @PostMapping("/comment/reply")
    @ApiOperation(value = "回复评论")
    public ApiResponse replyToComment(
            @ApiParam(value = "评论ID", required = true) @RequestParam Long commentId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId,
            @ApiParam(value = "回复内容", required = true) @RequestParam String content) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoCommentsService.replyToComment(commentId, userId, content);
    }

    /**
     * 获取评论回复
     *
     * @param commentId 评论ID
     * @param pageNum   页码
     * @param pageSize  每页大小
     * @return 包含评论回复列表的ApiResponse对象
     */
    @GetMapping("/comment/replies/{commentId}")
    @ApiOperation(value = "获取评论回复")
    public ApiResponse getCommentReplies(
            @ApiParam(value = "评论ID", required = true) @PathVariable Long commentId,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {
        return videoCommentsService.getCommentReplies(commentId, pageNum, pageSize);
    }


    /**
     * 发送弹幕
     *
     * @param videoId   视频ID
     * @param userId    用户ID
     * @param content   弹幕内容
     * @param timestamp 弹幕显示时间戳（秒）
     * @param color     弹幕颜色（可选）
     * @param position  弹幕位置（可选）
     * @param fontSize  弹幕字体大小（可选）
     * @param type      弹幕类型（可选）
     * @return 包含发送弹幕结果的ApiResponse对象
     */
    @PostMapping("/danmaku/send")
    @ApiOperation(value = "发送弹幕")
    public ApiResponse sendDanmaku(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId,
            @ApiParam(value = "弹幕内容", required = true) @RequestParam String content,
            @ApiParam(value = "弹幕显示时间戳（秒）", required = true) @RequestParam Integer timestamp,
            @ApiParam(value = "弹幕颜色（可选）", required = false) @RequestParam(required = false) String color,
            @ApiParam(value = "弹幕位置（可选）", required = false) @RequestParam(required = false) String position,
            @ApiParam(value = "弹幕字体大小（可选）", required = false) Integer fontSize,
            @ApiParam(value = "弹幕类型（可选）", required = false) Integer type) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoDanmakuService.sendDanmaku(videoId, userId, content, timestamp, color, type, fontSize);
    }

    /**
     * 获取视频弹幕
     *
     * @param videoId 视频ID
     * @param startTime 弹幕开始时间（秒）（可选）
     * @param endTime 弹幕结束时间（秒）（可选）
     * @return 包含视频弹幕列表的ApiResponse对象
     */
    @GetMapping("/danmaku/{videoId}")
    @ApiOperation(value = "获取视频弹幕")
    public ApiResponse getVideoDanmaku(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "弹幕开始时间（秒）（可选）", required = false) @RequestParam(required = false) Integer startTime,
            @ApiParam(value = "弹幕结束时间（秒）（可选）", required = false) @RequestParam(required = false) Integer endTime) {
        return videoDanmakuService.getVideoDanmaku(videoId, startTime, endTime);
    }

    /**
     * 删除弹幕
     *
     * @param danmakuId 弹幕ID
     * @param userId 用户ID
     * @return 包含删除结果的ApiResponse对象
     */
    @DeleteMapping("/danmaku/{danmakuId}")
    @ApiOperation(value = "删除弹幕")
    public ApiResponse deleteDanmaku(
            @ApiParam(value = "弹幕ID", required = true) @PathVariable Long danmakuId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {
        return videoDanmakuService.deleteDanmaku(danmakuId, userId);
    }

    /**
     * 获取用户行为分析
     *
     * @param userId 用户ID
     * @param startDate 开始日期（可选）
     * @param endDate 结束日期（可选）
     * @return 包含用户行为分析结果的ApiResponse对象
     */
    @GetMapping("/analytics/user/{userId}")
    @ApiOperation(value = "获取用户行为分析")
    public ApiResponse getUserAnalytics(
            @ApiParam(value = "用户ID", required = true) @PathVariable Long userId,
            @ApiParam(value = "开始日期（可选）", required = false) @RequestParam(required = false) String startDate,
            @ApiParam(value = "结束日期（可选）", required = false) @RequestParam(required = false) String endDate) {
        return videoStatisticsService.getUserAnalytics(userId, startDate, endDate);
    }

    /**
     * 获取视频数据分析
     *
     * @param videoId 视频ID
     * @param startDate 开始日期（可选）
     * @param endDate 结束日期（可选）
     * @return 包含视频数据分析结果的ApiResponse对象
     */
    @GetMapping("/analytics/video/{videoId}")
    @ApiOperation(value = "获取视频数据分析")
    public ApiResponse getVideoAnalytics(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "开始日期（可选）", required = false) @RequestParam(required = false) String startDate,
            @ApiParam(value = "结束日期（可选）", required = false) @RequestParam(required = false) String endDate) {
        return videoStatisticsService.getVideoAnalytics(videoId, startDate, endDate);
    }

    /**
     * 获取视频留存率
     *
     * @param videoId 视频ID
     * @return 包含视频留存率的ApiResponse对象
     */
    @GetMapping("/analytics/retention")
    @ApiOperation(value = "获取视频留存率")
    public ApiResponse getVideoRetention(@ApiParam(value = "视频ID", required = true) @RequestParam Long videoId) {
        return videoStatisticsService.getVideoRetention(videoId);
    }

    /**
     * 定时发布视频
     *
     * @param videoId 视频ID
     * @param publishTime 发布时间
     * @param userId 用户ID
     * @return 包含定时发布结果的ApiResponse对象
     */
    @PostMapping("/schedule")
    @ApiOperation(value = "定时发布视频")
    public ApiResponse scheduleVideo(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "发布时间", required = true) @RequestParam String publishTime,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {
        return videosService.scheduleVideo(videoId, publishTime, userId);
    }

    /**
     * 获取定时发布列表
     *
     * @param userId 用户ID
     * @param pageNum 页码
     * @param pageSize 每页大小
     * @return 包含定时发布列表的ApiResponse对象
     */
    @GetMapping("/schedule/list")
    @ApiOperation(value = "获取定时发布列表")
    public ApiResponse getScheduledVideos(
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {
        return videosService.getScheduledVideos(userId, pageNum, pageSize);
    }

    /**
     * 取消定时发布
     *
     * @param videoId 视频ID
     * @param userId 用户ID
     * @return 包含取消定时发布结果的ApiResponse对象
     */
    @DeleteMapping("/schedule/{videoId}")
    @ApiOperation(value = "取消定时发布")
    public ApiResponse cancelScheduledVideo(
            @ApiParam(value = "视频ID", required = true) @PathVariable Long videoId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {
        return videosService.cancelScheduledVideo(videoId, userId);
    }

    /**
     * 开始直播
     *
     * @param userId 用户ID
     * @param title 直播标题
     * @param description 直播描述（可选）
     * @return 包含开始直播结果的ApiResponse对象
     */
    @PostMapping("/live/start")
    @ApiOperation(value = "开始直播")
    public ApiResponse startLiveStream(
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId,
            @ApiParam(value = "直播标题", required = true) @RequestParam String title,
            @ApiParam(value = "直播描述（可选）", required = false) @RequestParam(required = false) String description) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoLiveService.startLiveStream(userId, title, description);
    }

    /**
     * 结束直播
     *
     * @param streamId 直播流ID
     * @param userId 用户ID
     * @return 包含结束直播结果的ApiResponse对象
     */
    @PostMapping("/live/end/{streamId}")
    @ApiOperation(value = "结束直播")
    public ApiResponse endLiveStream(
            @ApiParam(value = "直播流ID", required = true) @PathVariable String streamId,
            @ApiParam(value = "用户ID", required = true) @RequestParam Long userId) {
        return videoLiveService.endLiveStream(streamId, userId);
    }

    /**
     * 获取直播信息
     *
     * @param streamId 直播流ID
     * @return 包含直播信息的ApiResponse对象
     */
    @GetMapping("/live/info/{streamId}")
    @ApiOperation(value = "获取直播信息")
    public ApiResponse getLiveStreamInfo(@ApiParam(value = "直播流ID", required = true) @PathVariable String streamId) {
        return videoLiveService.getLiveStreamInfo(streamId);
    }

    /**
     * 获取直播列表
     *
     * @param pageNum 页码
     * @param pageSize 每页大小
     * @return 包含直播列表的ApiResponse对象
     */
    @GetMapping("/live/list")
    @ApiOperation(value = "获取直播列表")
    public ApiResponse getLiveStreams(
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize) {
        return videoLiveService.getLiveStreams(pageNum, pageSize);
    }

    /**
     * 获取背景音乐列表
     *
     * @param pageNum 页码
     * @param pageSize 每页大小
     * @param category 类别（可选）
     * @return 包含背景音乐列表的ApiResponse对象
     */
    @GetMapping("/music/list")
    @ApiOperation(value = "获取背景音乐列表")
    public ApiResponse getMusicList(
            @ApiParam(value = "每页大小", defaultValue = "10") @RequestParam(defaultValue = "10") Integer pageSize,
            @ApiParam(value = "页码", defaultValue = "1") @RequestParam(defaultValue = "1") Integer pageNum,
            @ApiParam(value = "类别（可选）", required = false) @RequestParam(required = false) String category) {
        return videoMusicService.getMusicList(pageSize, pageNum, category);
    }

    /**
     * 添加背景音乐
     *
     * @param videoId 视频ID
     * @param musicId 音乐ID
     * @param startTime 开始时间（秒）（可选）
     * @param duration 持续时间（秒）（可选）
     * @param volume 音量（可选）
     * @return 包含添加背景音乐结果的ApiResponse对象
     */
    @PostMapping("/music/add")
    @ApiOperation(value = "添加背景音乐")
    public ApiResponse addBackgroundMusic(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "音乐ID", required = true) @RequestParam Long musicId,
            @ApiParam(value = "开始时间（秒）（可选）", required = false) @RequestParam(required = false) Integer startTime,
            @ApiParam(value = "持续时间（秒）（可选）", required = false) @RequestParam(required = false) Integer duration,
            @ApiParam(value = "音量（可选）", required = false) @RequestParam(required = false) Float volume) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoMusicService.addBackgroundMusic(videoId, musicId, startTime, duration, volume);
    }

    /**
     * 移除背景音乐
     *
     * @param videoId 视频ID
     * @return 包含移除背景音乐结果的ApiResponse对象
     */
    @DeleteMapping("/music/remove/{videoId}")
    @ApiOperation(value = "移除背景音乐")
    public ApiResponse removeBackgroundMusic(@ApiParam(value = "视频ID", required = true) @PathVariable Long videoId) {
        return videoMusicService.removeBackgroundMusic(videoId);
    }

    /**
     * 裁剪视频
     *
     * @param videoId 视频ID
     * @param startTime 裁剪开始时间（秒）
     * @param endTime 裁剪结束时间（秒）
     * @return 包含裁剪结果的ApiResponse对象
     */
    @PostMapping("/edit/trim")
    @ApiOperation(value = "裁剪视频")
    public ApiResponse trimVideo(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "裁剪开始时间（秒）", required = true) @RequestParam Integer startTime,
            @ApiParam(value = "裁剪结束时间（秒）", required = true) @RequestParam Integer endTime) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoEditService.trimVideo(videoId, startTime, endTime);
    }

    /**
     * 合并多个视频
     *
     * @param videoIds 视频ID列表
     * @param title 合并后的视频标题
     * @param description 合并后的视频描述（可选）
     * @return 包含合并结果的ApiResponse对象
     */
    @PostMapping("/edit/merge")
    @ApiOperation(value = "合并多个视频")
    public ApiResponse mergeVideos(
            @ApiParam(value = "视频ID列表", required = true) @RequestParam List<Long> videoIds,
            @ApiParam(value = "合并后的视频标题", required = true) @RequestParam String title,
            @ApiParam(value = "合并后的视频描述（可选）", required = false) @RequestParam(required = false) String description) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoEditService.mergeVideos(videoIds, title, description);
    }

    /**
     * 添加视频滤镜
     *
     * @param videoId 视频ID
     * @param filterType 滤镜类型
     * @param filterParams 滤镜参数（可选）
     * @return 包含添加滤镜结果的ApiResponse对象
     */
    @PostMapping("/edit/filter")
    @ApiOperation(value = "添加视频滤镜")
    public ApiResponse addVideoFilter(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "滤镜类型", required = true) @RequestParam String filterType,
            @ApiParam(value = "滤镜参数（可选）", required = false) @RequestParam(required = false) Map<String, Object> filterParams) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoEditService.addVideoFilter(videoId, filterType, filterParams);
    }

    /**
     * 添加视频文字
     *
     * @param videoId 视频ID
     * @param text 文字内容
     * @param startTime 文字显示开始时间（秒）
     * @param duration 文字显示持续时间（秒）
     * @param textStyle 文字样式参数（可选）
     * @return 包含添加文字结果的ApiResponse对象
     */
    @PostMapping("/edit/text")
    @ApiOperation(value = "添加视频文字")
    public ApiResponse addVideoText(
            @ApiParam(value = "视频ID", required = true) @RequestParam Long videoId,
            @ApiParam(value = "文字内容", required = true) @RequestParam String text,
            @ApiParam(value = "文字显示开始时间（秒）", required = true) @RequestParam Integer startTime,
            @ApiParam(value = "文字显示持续时间（秒）", required = true) @RequestParam Integer duration,
            @ApiParam(value = "文字样式参数（可选）", required = false) @RequestParam(required = false) Map<String, Object> textStyle) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoEditService.addVideoText(videoId, text, startTime, duration, textStyle);
    }

    /**
     * 获取视频编辑进度
     *
     * @param taskId 任务ID
     * @return 包含编辑进度的ApiResponse对象
     */
    @GetMapping("/edit/progress/{taskId}")
    @ApiOperation(value = "获取视频编辑进度")
    public ApiResponse getEditProgress(@ApiParam(value = "任务ID", required = true) @PathVariable String taskId) {
        return videoEditService.getEditProgress(taskId);
    }
}
