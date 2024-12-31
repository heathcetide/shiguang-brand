package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.utils.AliOssUtil;
import com.foodrecord.mapper.VideosMapper;
import com.foodrecord.model.entity.video.Videos;
import com.foodrecord.service.VideosService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class VideosServiceImpl implements VideosService {

    @Resource
    private VideosMapper videosMapper;

    @Override
    @Transactional
    public ApiResponse uploadVideo(MultipartFile file, String title, String description, Long userId, List<String> tags) {
        try {
            // 处理视频文件上传
            String videoUrl = handleVideoUpload(file);
            String thumbnailUrl = generateThumbnail(videoUrl);
            int duration = getVideoDuration(videoUrl);

            Videos video = new Videos();
            video.setUserId(userId);
            video.setTitle(title);
            video.setDescription(description);
            video.setVideoUrl(videoUrl);
            video.setThumbnailUrl(thumbnailUrl);
            video.setDuration(duration);
            video.setViewsCount(0);
            video.setLikesCount(0);
            video.setCommentsCount(0);
            video.setCreatedAt(new Date());
            video.setUpdatedAt(new Date());
            video.setIsDelete(0);

            int rows = videosMapper.save(video);
            if (rows > 0) {
                return ApiResponse.success(video);
            }
            return ApiResponse.error(300, "上传失败");
        } catch (Exception e) {
            return ApiResponse.error(300, "上传视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideoDetails(Long id) {
        try {
            Map<String, Object> videoDetails = videosMapper.selectVideoDetails(id);
            if (videoDetails != null) {
                // 异步增加观看次数
                CompletableFuture.runAsync(() -> {
                    videosMapper.incrementViewCount(id);
                });
                return ApiResponse.success(videoDetails);
            }
            return ApiResponse.error(300, "视频不存在");
        } catch (Exception e) {
            return ApiResponse.error(300, "获取视频详情失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getRecommendedVideos(Long userId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> videos = videosMapper.selectRecommendedVideos(offset, pageSize);
            
            // 异步增加观看次数
            if (!videos.isEmpty()) {
                CompletableFuture.runAsync(() -> {
                    videos.forEach(video -> 
                        videosMapper.incrementViewCount((Long)video.get("id"))
                    );
                });
            }
            return ApiResponse.success(videos);
        } catch (Exception e) {
            return ApiResponse.error(300,"获取推荐视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse searchVideos(String keyword, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Videos> videos = videosMapper.searchVideos(keyword, offset, pageSize);
            return ApiResponse.success(videos);
        } catch (Exception e) {
            return ApiResponse.error(300, "搜索视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getVideosByTag(String tag, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Videos> videos = videosMapper.selectVideosByTag(tag, offset, pageSize);
            return ApiResponse.success(videos);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取标签视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getUserVideos(Long userId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Videos> videos = videosMapper.selectUserVideos(userId, offset, pageSize);
            return ApiResponse.success(videos);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取用户视频失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse deleteVideo(Long id, Long userId) {
        try {
            int rows = videosMapper.deleteVideo(id, userId);
            if (rows > 0) {
                return ApiResponse.success("删除成功");
            }
            return ApiResponse.error(300, "删除失败，视频不存在或无权限");
        } catch (Exception e) {
            return ApiResponse.error(300, "删除视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse updateVideo(Videos video) {
        try {
            video.setUpdatedAt(new Date());
            int rows = videosMapper.updateVideo(video);
            if (rows > 0) {
                return ApiResponse.success("更新成功");
            }
            return ApiResponse.error(300, "更新失败，视频不存在或无权限");
        } catch (Exception e) {
            return ApiResponse.error(300, "更新视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getNextVideo(Long lastVideoId) {
        try {
            Map<String, Object> video = videosMapper.getNextVideo(lastVideoId);
            if (video != null) {
                // 异步增加观看次数
                CompletableFuture.runAsync(() -> {
                    videosMapper.incrementViewCount((Long)video.get("id"));
                });
                return ApiResponse.success(video);
            }
            return ApiResponse.error(300,"没有更多视频了");
        } catch (Exception e) {
            return ApiResponse.error(300,"获取视频失败"+ e.getMessage());
        }
    }

    @Override
    public ApiResponse getTrendingVideos(Integer pageNum, Integer pageSize, String timeRange) {
        try {
            int offset = (pageNum - 1) * pageSize;
            Date startDate = null;
            
            // 根据时间范围计算起始时间
            if (timeRange != null) {
                Calendar calendar = Calendar.getInstance();
                switch (timeRange.toLowerCase()) {
                    case "day":
                        calendar.add(Calendar.DAY_OF_MONTH, -1);
                        break;
                    case "week":
                        calendar.add(Calendar.WEEK_OF_YEAR, -1);
                        break;
                    case "month":
                        calendar.add(Calendar.MONTH, -1);
                        break;
                    default:
                        calendar.add(Calendar.MONTH, -1); // 默认一个月
                }
                startDate = calendar.getTime();
            }

            List<Videos> videos = videosMapper.selectTrendingVideos(offset, pageSize, startDate);
            return ApiResponse.success(videos);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取热门视频失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getTrendingByCategory(String category, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Videos> videos = videosMapper.selectTrendingByCategory(category, offset, pageSize);
            return ApiResponse.success(videos);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取分类热门视频失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse scheduleVideo(Long videoId, String publishTime, Long userId) {
        try {
            // 验证视频所有权
            Videos video = videosMapper.selectById(videoId);
            if (video == null || !video.getUserId().equals(userId)) {
                return ApiResponse.error(300, "视频不存在或无权限");
            }

            // 解析发布时间
            Date scheduleTime = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").parse(publishTime);
            if (scheduleTime.before(new Date())) {
                return ApiResponse.error(300, "定时发布时间不能早于当前时间");
            }

            // 创建定时任务
            videosMapper.insertScheduleTask(videoId, userId, scheduleTime);
            
            return ApiResponse.success("定时发布设置成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "设置定时发布失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getScheduledVideos(Long userId, Integer pageNum, Integer pageSize) {
        try {
            int offset = (pageNum - 1) * pageSize;
            List<Map<String, Object>> scheduledVideos = videosMapper.selectScheduledVideos(userId, offset, pageSize);
            return ApiResponse.success(scheduledVideos);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取定时发布列表失败：" + e.getMessage());
        }
    }

    @Override
    @Transactional
    public ApiResponse cancelScheduledVideo(Long videoId, Long userId) {
        try {
            // 验证视频所有权
            Videos video = videosMapper.selectById(videoId);
            if (video == null || !video.getUserId().equals(userId)) {
                return ApiResponse.error(300, "视频不存在或无权限");
            }

            // 删除定时任务
            int rows = videosMapper.deleteScheduleTask(videoId, userId);
            if (rows > 0) {
                return ApiResponse.success("取消定时发布成功");
            }
            return ApiResponse.error(300, "未找到相关定时发布任务");
        } catch (Exception e) {
            return ApiResponse.error(300, "取消定时发布失败：" + e.getMessage());
        }
    }

    // 私有辅助方法
    private String handleVideoUpload(MultipartFile file) throws Exception {
        //1.把文件的内容存储到本地磁盘上
        String originalFilename = file.getOriginalFilename();
        //2.保证文件名是唯一的，从而防止文件被覆盖
        String filename = UUID.randomUUID() +originalFilename.substring(originalFilename.lastIndexOf("."));
        //3.调用阿里云
        return AliOssUtil.uploadFile(filename,file.getInputStream());
    }

    private String generateThumbnail(String videoUrl) {
        try {
            // 使用FFmpeg工具生成视频的缩略图
            String thumbnailFilename = UUID.randomUUID().toString() + ".jpg";
            String systemPath = System.getProperty("user.dir") + "\\tmp\\" + thumbnailFilename;  // 使用反斜杠
            // 使用双引号处理路径，防止空格或特殊字符引起问题
            String command = String.format("ffmpeg -i \"%s\" -ss 00:00:01.000 -vframes 1 \"%s\"", videoUrl, systemPath);

            System.out.println("命令来了");
            System.out.println(command);

            // 执行命令
            Process process = Runtime.getRuntime().exec(command);
            int exitCode = process.waitFor();
            if (exitCode == 0) {
                // 上传缩略图到阿里云OSS
                return AliOssUtil.uploadFile(thumbnailFilename, Files.newInputStream(Paths.get(systemPath)));
            } else {
                throw new RuntimeException("生成缩略图失败");
            }
        } catch (Exception e) {
            throw new RuntimeException("生成缩略图时发生错误: " + e.getMessage(), e);
        }
    }


    private int getVideoDuration(String videoUrl) {
        try {
            // 使用FFmpeg工具获取视频时长
            String command = String.format("ffmpeg -i %s 2>&1", videoUrl);
            Process process = Runtime.getRuntime().exec(command);
            Scanner scanner = new Scanner(process.getErrorStream());
            String durationRegex = "Duration: (?<hours>\\d+):(?<minutes>\\d+):(?<seconds>\\d+\\.\\d+)";
            Pattern pattern = Pattern.compile(durationRegex);
            while (scanner.hasNextLine()) {
                String line = scanner.nextLine();
                Matcher matcher = pattern.matcher(line);
                if (matcher.find()) {
                    int hours = Integer.parseInt(matcher.group("hours"));
                    int minutes = Integer.parseInt(matcher.group("minutes"));
                    int seconds = (int) Math.round(Double.parseDouble(matcher.group("seconds")));
                    return hours * 3600 + minutes * 60 + seconds;
                }
            }
            throw new RuntimeException("未能获取视频时长");
        } catch (Exception e) {
            throw new RuntimeException("获取视频时长时发生错误: " + e.getMessage(), e);
        }
    }

    private void validateVideoOwnership(Long videoId, Long userId) {
        Videos video = videosMapper.selectById(videoId);
        if (video == null || !video.getUserId().equals(userId)) {
            throw new RuntimeException("视频不存在或无权限");
        }
    }

}




