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

    // 限流器配置
    private final RateLimiter rateLimiter = RateLimiter.create(20.0);

    // 视频缓存
    private final Cache<String, Videos> videoCache = CacheBuilder.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .maximumSize(1000)
            .build();


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
}
