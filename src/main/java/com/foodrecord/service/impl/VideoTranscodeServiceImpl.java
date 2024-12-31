package com.foodrecord.service.impl;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.mapper.VideoTranscodeMapper;
import com.foodrecord.mapper.VideosMapper;
import com.foodrecord.model.entity.video.VideoTranscodeTask;
import com.foodrecord.service.VideoTranscodeService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.io.*;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.UUID;

@Service
public class VideoTranscodeServiceImpl implements VideoTranscodeService {

    @Resource
    private VideoTranscodeMapper videoTranscodeMapper;

    @Resource
    private VideosMapper videosMapper;

    @Value("${upload.temp.path}")
    private String uploadTempPath;

    @Value("${upload.video.path}")
    private String uploadVideoPath;

    @Override
    public ApiResponse submitTranscode(Long videoId, String format) {
        try {
            // 1. 创建转码任务
            VideoTranscodeTask transcode = new VideoTranscodeTask();
            transcode.setVideoId(videoId);
            transcode.setFormat(format);
            transcode.setId(Long.valueOf(UUID.randomUUID().toString()));
            transcode.setStatus(0); // 待处理
            videoTranscodeMapper.insert(transcode);

            // 2. 提交异步转码任务
            // TODO: 实现异步转码逻辑

            return ApiResponse.success(transcode.getId());
        } catch (Exception e) {
            return ApiResponse.error(300, "提交转码失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getTranscodeProgress(String taskId) {
        try {
            VideoTranscodeTask transcode = videoTranscodeMapper.selectByTaskId(taskId);
            if (transcode == null) {
                return ApiResponse.error(300, "转码任务不存在");
            }
            return ApiResponse.success(transcode);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取转码进度失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse getTranscodeRecords(Long videoId) {
        try {
            List<VideoTranscodeTask> records = videoTranscodeMapper.selectByVideoId(videoId);
            return ApiResponse.success(records);
        } catch (Exception e) {
            return ApiResponse.error(300, "获取转码记录失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse cancelTranscode(String taskId) {
        try {
            videoTranscodeMapper.updateStatus(taskId, 3); // 已取消
            // TODO: 取消转码任务的具体实现
            return ApiResponse.success("取消转码成功");
        } catch (Exception e) {
            return ApiResponse.error(300, "取消转码失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse uploadChunk(MultipartFile file, Integer chunkNumber, Integer totalChunks, String fileId) {
        try {
            // 1. 创建临时目录
            String chunkDirPath = uploadTempPath + File.separator + fileId;
            Path chunkDir = Paths.get(chunkDirPath);
            if (!Files.exists(chunkDir)) {
                Files.createDirectories(chunkDir);
            }

            // 2. 保存分片文件
            String chunkPath = chunkDirPath + File.separator + chunkNumber;
            file.transferTo(new File(chunkPath));

            // 3. 返回当前分片上传结果
            return ApiResponse.success(String.format("分片 %d/%d 上传成功", chunkNumber, totalChunks));
        } catch (Exception e) {
            return ApiResponse.error(300, "分片上传失败：" + e.getMessage());
        }
    }

    @Override
    public ApiResponse mergeChunks(String fileId, String fileName, Integer totalChunks) {
        try {
            // 1. 检查所有分片是否都已上传
            String chunkDirPath = uploadTempPath + File.separator + fileId;
            File chunkDir = new File(chunkDirPath);
            if (!chunkDir.exists()) {
                return ApiResponse.error(300, "未找到上传的分片文件");
            }

            // 2. 创建最终文件
            String finalFilePath = uploadVideoPath + File.separator + UUID.randomUUID() + "_" + fileName;
            File finalFile = new File(finalFilePath);
            if (!finalFile.exists()) {
                finalFile.createNewFile();
            }

            // 3. 合并分片
            try (FileChannel finalChannel = new FileOutputStream(finalFile, true).getChannel()) {
                for (int i = 1; i <= totalChunks; i++) {
                    File chunkFile = new File(chunkDirPath + File.separator + i);
                    if (!chunkFile.exists()) {
                        return ApiResponse.error(300, "分片 " + i + " 不存在");
                    }

                    try (FileChannel chunkChannel = new FileInputStream(chunkFile).getChannel()) {
                        chunkChannel.transferTo(0, chunkChannel.size(), finalChannel);
                    }
                }
            }

            // 4. 清理临时文件
            deleteDirectory(chunkDir);

            // 5. 创建转码任务
            VideoTranscodeTask task = new VideoTranscodeTask();
            task.setId(Long.valueOf(UUID.randomUUID().toString()));
//            task.setSourcePath(finalFilePath);
            task.setStatus(0); // 待处理
            videoTranscodeMapper.insert(task);

            return ApiResponse.success(task.getId());
        } catch (Exception e) {
            return ApiResponse.error(300, "合并分片失败：" + e.getMessage());
        }
    }

    /**
     * 递归删除目录及其内容
     */
    private void deleteDirectory(File directory) {
        if (directory.exists()) {
            File[] files = directory.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (file.isDirectory()) {
                        deleteDirectory(file);
                    } else {
                        file.delete();
                    }
                }
            }
            directory.delete();
        }
    }
} 