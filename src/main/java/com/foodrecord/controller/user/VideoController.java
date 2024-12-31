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

    @PostMapping("/upload")
    @ApiOperation(value = "上传视频")
    public ApiResponse uploadVideo(
            @RequestPart("file")  MultipartFile file,
            @RequestParam("title") String title,
            @RequestParam("description") String description,
            @RequestParam("userId") Long userId,
            @RequestParam(value = "tags", required = false) List<String> tags) {
        
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }

        return videosService.uploadVideo(file, title, description, userId, tags);
    }

    @GetMapping("/{id}")
    @ApiOperation(value = "获取视频详情")
    public ApiResponse getVideoDetails(@PathVariable Long id) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.success( "请求过于频繁");
        }

        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:detail:" + id;
            Map<String, Object> videoDetails = (Map<String, Object>) redisTemplate.opsForValue().get(cacheKey);
            
            if (videoDetails != null) {
                return ApiResponse.success(videoDetails);
            }

            ApiResponse<Map<String, Object>> result = videosService.getVideoDetails(id);
            if (result != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return ApiResponse.success(result);
        }).join();
    }

    @PostMapping("/comment")
    @ApiOperation(value = "发表评论")
    public ApiResponse addComment(@RequestBody VideoComments comment) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.success( "请求过于频繁");
        }

        comment.setCreatedAt(new Date());
        comment.setUpdatedAt(new Date());
        return videoCommentsService.addComment(comment);
    }

    @GetMapping("/comments/{videoId}")
    @ApiOperation(value = "获取视频评论")
    public ApiResponse getVideoComments(
            @PathVariable Long videoId,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "20") Integer pageSize) {
        
        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:comments:" + videoId + ":" + pageNum + ":" + pageSize;
            List<Map<String, Object>> comments = (List<Map<String, Object>>) redisTemplate.opsForValue().get(cacheKey);
            
            if (comments != null) {
                return ApiResponse.success(comments);
            }

            ApiResponse<List<Map<String, Object>>> result = videoCommentsService.getVideoComments(videoId, pageNum, pageSize);
            if (result != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return result;
        }).join();
    }

    @PostMapping("/like/{videoId}")
    @ApiOperation(value = "点赞视频")
    public ApiResponse likeVideo(
            @PathVariable Long videoId,
            @RequestParam Long userId) {
        
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.success( "请求过于频繁");
        }

        return videoLikesService.likeVideo(videoId, userId);
    }

    @DeleteMapping("/unlike/{videoId}")
    @ApiOperation(value = "取消点赞")
    public ApiResponse  unlikeVideo(
            @PathVariable Long videoId,
            @RequestParam Long userId) {
        
        return videoLikesService.unlikeVideo(videoId, userId);
    }

    @PostMapping("/favorite/{videoId}")
    @ApiOperation(value = "收藏视频")
    public ApiResponse  favoriteVideo(
            @PathVariable Long videoId,
            @RequestParam Long userId) {
        
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.success( "请求过于频繁");
        }

        return videoFavoritesService.favoriteVideo(videoId, userId);
    }

    @DeleteMapping("/unfavorite/{videoId}")
    @ApiOperation(value = "取消收藏")
    public ApiResponse  unfavoriteVideo(
            @PathVariable Long videoId,
            @RequestParam Long userId) {
        
        return videoFavoritesService.unfavoriteVideo(videoId, userId);
    }

    @GetMapping("/search")
    @ApiOperation(value = "搜索视频")
    public ApiResponse  searchVideos(
            @RequestParam String keyword,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.success( "请求过于频繁");
        }

        return videosService.searchVideos(keyword, pageNum, pageSize);
    }

    @GetMapping("/byTag/{tag}")
    @ApiOperation(value = "根据标签获取视频")
    public ApiResponse  getVideosByTag(
            @PathVariable String tag,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        
        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:tag:" + tag + ":" + pageNum;
            List<Videos> videos = (List<Videos>) redisTemplate.opsForValue().get(cacheKey);
            
            if (videos != null) {
                return ApiResponse.success(videos);
            }

            ApiResponse result = videosService.getVideosByTag(tag, pageNum, pageSize);
            if (result != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return result;
        }).join();
    }

    @GetMapping("/user/{userId}")
    @ApiOperation(value = "获取用户发布的视频")
    public ApiResponse  getUserVideos(
            @PathVariable Long userId,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        
        return videosService.getUserVideos(userId, pageNum, pageSize);
    }

    @DeleteMapping("/{id}")
    @ApiOperation(value = "删除视频")
    public ApiResponse  deleteVideo(
            @PathVariable Long id,
            @RequestParam Long userId) {
        
        return videosService.deleteVideo(id, userId);
    }

    @PutMapping("/update")
    @ApiOperation(value = "更新视频信息")
    public ApiResponse  updateVideo(@RequestBody Videos video) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.success( "请求过于频繁");
        }

        return videosService.updateVideo(video);
    }

    @GetMapping("/recommend")
    @ApiOperation(value = "获取推荐视频")
    public ApiResponse  getRecommendedVideos(
            @RequestParam(required = false) Long userId,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {

        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:recommend:" + (userId != null ? userId : "anonymous") + ":" + pageNum;
            List<Videos> videos = (List<Videos>) redisTemplate.opsForValue().get(cacheKey);

            if (videos != null) {
                return ApiResponse.success(videos);
            }

            ApiResponse result = videosService.getRecommendedVideos(userId, pageNum, pageSize);
            if (result != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return result;
        }).join();
    }

    @GetMapping("/next")
    @ApiOperation(value = "获取下一个视频")
    public ApiResponse getNextVideo(@RequestParam(required = false) Long lastVideoId) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.success( "请求过于频繁");
        }

        return CompletableFuture.supplyAsync(() -> {
            try {
                String cacheKey = "video:next:" + (lastVideoId != null ? lastVideoId : "first");
                Map<String, Object> video = (Map<String, Object>) redisTemplate.opsForValue().get(cacheKey);
                
                if (video != null) {
                    return ApiResponse.success(video);
                }

                ApiResponse result = videosService.getNextVideo(lastVideoId);
                if (result != null) {
                    redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
                }
                return result;
            } catch (Exception e) {
                return ApiResponse.error(300,"请求错误"+e.getMessage());
            }
        }).join();
    }

    @PostMapping("/chunk")
    @ApiOperation(value = "分片上传视频")
    public ApiResponse uploadVideoChunk(
            @RequestParam("file") MultipartFile file,
            @RequestParam("chunkNumber") Integer chunkNumber,
            @RequestParam("totalChunks") Integer totalChunks,
            @RequestParam("fileId") String fileId) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoTranscodeService.uploadChunk(file, chunkNumber, totalChunks, fileId);
    }

    @PostMapping("/merge")
    @ApiOperation(value = "合并视频分片")
    public ApiResponse mergeVideoChunks(
            @RequestParam("fileId") String fileId,
            @RequestParam("fileName") String fileName,
            @RequestParam("totalChunks") Integer totalChunks) {
        return videoTranscodeService.mergeChunks(fileId, fileName, totalChunks);
    }

    @PostMapping("/audit/submit")
    @ApiOperation(value = "提交视频审核")
    public ApiResponse submitVideoAudit(@RequestParam Long videoId) {
        return videoAuditService.submitAudit(videoId);
    }

    @GetMapping("/audit/status/{videoId}")
    @ApiOperation(value = "获取视频审核状态")
    public ApiResponse getVideoAuditStatus(@PathVariable Long videoId) {
        return videoAuditService.getAuditStatus(videoId);
    }

    @PostMapping("/statistics/play")
    @ApiOperation(value = "记录视频播放")
    public ApiResponse recordVideoPlay(
            @RequestParam Long videoId,
            @RequestParam(required = false) Long userId,
            @RequestParam String clientIp) {
        return videoStatisticsService.recordPlay(videoId, userId, clientIp);
    }

    @GetMapping("/statistics/{videoId}")
    @ApiOperation(value = "获取视频统计数据")
    public ApiResponse getVideoStatistics(@PathVariable Long videoId) {
        return videoStatisticsService.getStatistics(videoId);
    }

    @PostMapping("/history/add")
    @ApiOperation(value = "添加观看历史")
    public ApiResponse addVideoHistory(
            @RequestParam Long videoId,
            @RequestParam Long userId,
            @RequestParam Integer watchDuration) {
        return videoHistoryService.addHistory(videoId, userId, watchDuration);
    }

    @GetMapping("/history/user/{userId}")
    @ApiOperation(value = "获取用户观看历史")
    public ApiResponse getUserVideoHistory(
            @PathVariable Long userId,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        return videoHistoryService.getUserHistory(userId, pageNum, pageSize);
    }

    @PostMapping("/report")
    @ApiOperation(value = "举报视频")
    public ApiResponse reportVideo(
            @RequestParam Long videoId,
            @RequestParam Long userId,
            @RequestParam String reason,
            @RequestParam(required = false) String description) {
        return videoReportService.reportVideo(videoId, userId, reason, description);
    }

    @GetMapping("/report/status/{reportId}")
    @ApiOperation(value = "查询举报状态")
    public ApiResponse getReportStatus(@PathVariable Long reportId) {
        return videoReportService.getReportStatus(reportId);
    }

    @GetMapping("/quality/{videoId}")
    @ApiOperation(value = "获取视频可用清晰度")
    public ApiResponse getVideoQualities(@PathVariable Long videoId) {
        return videoQualityService.getAvailableQualities(videoId);
    }

    @GetMapping("/quality/{videoId}/{quality}")
    @ApiOperation(value = "获取指定清晰度的视频地址")
    public ApiResponse getVideoUrlByQuality(
            @PathVariable Long videoId,
            @PathVariable String quality) {
        return videoQualityService.getVideoUrl(videoId, quality);
    }

    @PostMapping("/watermark/add")
    @ApiOperation(value = "添加视频水印")
    public ApiResponse addWatermark(
            @RequestParam Long videoId,
            @RequestParam String watermarkText,
            @RequestParam(required = false) String position,
            @RequestParam(required = false) Float opacity) {
        return videoWatermarkService.addWatermark(videoId, watermarkText, position, opacity);
    }

    @GetMapping("/watermark/preview/{videoId}")
    @ApiOperation(value = "预览水印效果")
    public ApiResponse previewWatermark(
            @PathVariable Long videoId,
            @RequestParam String watermarkText,
            @RequestParam(required = false) String position) {
        return videoWatermarkService.previewWatermark(videoId, watermarkText, position);
    }

    @PostMapping("/share")
    @ApiOperation(value = "分享视频")
    public ApiResponse shareVideo(
            @RequestParam Long videoId,
            @RequestParam Long userId,
            @RequestParam String platform) {
        return videoShareService.shareVideo(videoId, userId, platform);
    }

    @GetMapping("/share/link/{videoId}")
    @ApiOperation(value = "获取分享链接")
    public ApiResponse getShareLink(
            @PathVariable Long videoId,
            @RequestParam(required = false) String platform) {
        return videoShareService.generateShareLink(videoId, 1L, platform);
    }

    @GetMapping("/trending")
    @ApiOperation(value = "获取热门视频")
    public ApiResponse getTrendingVideos(
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize,
            @RequestParam(required = false) String timeRange) {
        return CompletableFuture.supplyAsync(() -> {
            String cacheKey = "video:trending:" + timeRange + ":" + pageNum;
            List<Videos> videos = (List<Videos>) redisTemplate.opsForValue().get(cacheKey);
            
            if (videos != null) {
                return ApiResponse.success(videos);
            }

            ApiResponse result = videosService.getTrendingVideos(pageNum, pageSize, timeRange);
            if (result != null) {
                redisTemplate.opsForValue().set(cacheKey, result.getData(), 5, TimeUnit.MINUTES);
            }
            return result;
        }).join();
    }

    @GetMapping("/trending/categories")
    @ApiOperation(value = "获取分类热门视频")
    public ApiResponse getTrendingByCategory(
            @RequestParam String category,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        return videosService.getTrendingByCategory(category, pageNum, pageSize);
    }

    @PostMapping("/download/request")
    @ApiOperation(value = "请求下载视频")
    public ApiResponse requestVideoDownload(
            @RequestParam Long videoId,
            @RequestParam Long userId,
            @RequestParam(required = false) String quality) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoDownloadService.requestDownload(videoId, userId, quality);
    }

    @GetMapping("/download/{downloadId}")
    @ApiOperation(value = "获取下载链接")
    public ApiResponse getDownloadUrl(@PathVariable String downloadId) {
        return videoDownloadService.getDownloadUrl(Long.valueOf(downloadId));
    }

    @GetMapping("/download/progress/{downloadId}")
    @ApiOperation(value = "获取下载进度")
    public ApiResponse getDownloadProgress(@PathVariable String downloadId) {
        return videoDownloadService.getDownloadProgress(Long.valueOf(downloadId));
    }

    @PostMapping("/comment/reply")
    @ApiOperation(value = "回复评论")
    public ApiResponse replyToComment(
            @RequestParam Long commentId,
            @RequestParam Long userId,
            @RequestParam String content) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoCommentsService.replyToComment(commentId, userId, content);
    }

    @GetMapping("/comment/replies/{commentId}")
    @ApiOperation(value = "获取评论回复")
    public ApiResponse getCommentReplies(
            @PathVariable Long commentId,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        return videoCommentsService.getCommentReplies(commentId, pageNum, pageSize);
    }

    @PostMapping("/danmaku/send")
    @ApiOperation(value = "发送弹幕")
    public ApiResponse sendDanmaku(
            @RequestParam Long videoId,
            @RequestParam Long userId,
            @RequestParam String content,
            @RequestParam Integer timestamp,
            @RequestParam(required = false) String color,
            @RequestParam(required = false) String position,
            Integer fontSize,
            Integer type) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoDanmakuService.sendDanmaku(videoId, userId, content, timestamp, color, type, fontSize );
    }

    @GetMapping("/danmaku/{videoId}")
    @ApiOperation(value = "获取视频弹幕")
    public ApiResponse getVideoDanmaku(
            @PathVariable Long videoId,
            @RequestParam(required = false) Integer startTime,
            @RequestParam(required = false) Integer endTime) {
        return videoDanmakuService.getVideoDanmaku(videoId, startTime, endTime);
    }

    @DeleteMapping("/danmaku/{danmakuId}")
    @ApiOperation(value = "删除弹幕")
    public ApiResponse deleteDanmaku(
            @PathVariable Long danmakuId,
            @RequestParam Long userId) {
        return videoDanmakuService.deleteDanmaku(danmakuId, userId);
    }

    @GetMapping("/analytics/user/{userId}")
    @ApiOperation(value = "获取用户行为分析")
    public ApiResponse getUserAnalytics(
            @PathVariable Long userId,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return videoStatisticsService.getUserAnalytics(userId, startDate, endDate);
    }

    @GetMapping("/analytics/video/{videoId}")
    @ApiOperation(value = "获取视频数据分析")
    public ApiResponse getVideoAnalytics(
            @PathVariable Long videoId,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return videoStatisticsService.getVideoAnalytics(videoId, startDate, endDate);
    }

    @GetMapping("/analytics/retention")
    @ApiOperation(value = "获取视频留存率")
    public ApiResponse getVideoRetention(@RequestParam Long videoId) {
        return videoStatisticsService.getVideoRetention(videoId);
    }

    @PostMapping("/schedule")
    @ApiOperation(value = "定时发布视频")
    public ApiResponse scheduleVideo(
            @RequestParam Long videoId,
            @RequestParam String publishTime,
            @RequestParam Long userId) {
        return videosService.scheduleVideo(videoId, publishTime, userId);
    }

    @GetMapping("/schedule/list")
    @ApiOperation(value = "获取定时发布列表")
    public ApiResponse getScheduledVideos(
            @RequestParam Long userId,
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        return videosService.getScheduledVideos(userId, pageNum, pageSize);
    }

    @DeleteMapping("/schedule/{videoId}")
    @ApiOperation(value = "取消定时发布")
    public ApiResponse cancelScheduledVideo(
            @PathVariable Long videoId,
            @RequestParam Long userId) {
        return videosService.cancelScheduledVideo(videoId, userId);
    }

    // 视频直播相关接口
    @PostMapping("/live/start")
    @ApiOperation(value = "开始直播")
    public ApiResponse startLiveStream(
            @RequestParam Long userId,
            @RequestParam String title,
            @RequestParam(required = false) String description) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoLiveService.startLiveStream(userId, title, description);
    }

    @PostMapping("/live/end/{streamId}")
    @ApiOperation(value = "结束直播")
    public ApiResponse endLiveStream(
            @PathVariable String streamId,
            @RequestParam Long userId) {
        return videoLiveService.endLiveStream(streamId, userId);
    }

    @GetMapping("/live/info/{streamId}")
    @ApiOperation(value = "获取直播信息")
    public ApiResponse getLiveStreamInfo(@PathVariable String streamId) {
        return videoLiveService.getLiveStreamInfo(streamId);
    }

    @GetMapping("/live/list")
    @ApiOperation(value = "获取直播列表")
    public ApiResponse getLiveStreams(
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize) {
        return videoLiveService.getLiveStreams(pageNum, pageSize);
    }

    // 背景音乐相关接口
    @GetMapping("/music/list")
    @ApiOperation(value = "获取背景音乐列表")
    public ApiResponse getMusicList(
            @RequestParam(defaultValue = "1") Integer pageNum,
            @RequestParam(defaultValue = "10") Integer pageSize,
            @RequestParam(required = false) String category) {
        return videoMusicService.getMusicList(pageSize,pageNum,category);
    }

    @PostMapping("/music/add")
    @ApiOperation(value = "添加背景音乐")
    public ApiResponse addBackgroundMusic(
            @RequestParam Long videoId,
            @RequestParam Long musicId,
            @RequestParam(required = false) Integer startTime,
            @RequestParam(required = false) Integer duration,
            @RequestParam(required = false) Float volume) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoMusicService.addBackgroundMusic(videoId, musicId, startTime, duration, volume);
    }

    @DeleteMapping("/music/remove/{videoId}")
    @ApiOperation(value = "移除背景音乐")
    public ApiResponse removeBackgroundMusic(@PathVariable Long videoId) {
        return videoMusicService.removeBackgroundMusic(videoId);
    }

    // 视频编辑相关接口
    @PostMapping("/edit/trim")
    @ApiOperation(value = "裁剪视频")
    public ApiResponse trimVideo(
            @RequestParam Long videoId,
            @RequestParam Integer startTime,
            @RequestParam Integer endTime) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoEditService.trimVideo(videoId, startTime, endTime);
    }

    @PostMapping("/edit/merge")
    @ApiOperation(value = "合并多个视频")
    public ApiResponse mergeVideos(
            @RequestParam List<Long> videoIds,
            @RequestParam String title,
            @RequestParam(required = false) String description) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoEditService.mergeVideos(videoIds, title, description);
    }

    @PostMapping("/edit/filter")
    @ApiOperation(value = "添加视频滤镜")
    public ApiResponse addVideoFilter(
            @RequestParam Long videoId,
            @RequestParam String filterType,
            @RequestParam(required = false) Map<String, Object> filterParams) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoEditService.addVideoFilter(videoId, filterType, filterParams);
    }

    @PostMapping("/edit/text")
    @ApiOperation(value = "添加视频文字")
    public ApiResponse addVideoText(
            @RequestParam Long videoId,
            @RequestParam String text,
            @RequestParam Integer startTime,
            @RequestParam Integer duration,
            @RequestParam(required = false) Map<String, Object> textStyle) {
        if (!rateLimiter.tryAcquire()) {
            return ApiResponse.error(300, "请求过于频繁");
        }
        return videoEditService.addVideoText(videoId, text, startTime, duration, textStyle);
    }

    @GetMapping("/edit/progress/{taskId}")
    @ApiOperation(value = "获取视频编辑进度")
    public ApiResponse getEditProgress(@PathVariable String taskId) {
        return videoEditService.getEditProgress(taskId);
    }
}
