package com.foodrecord.service.storage;

import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

@Service
public class FileStorageService {

    private final String uploadDir = "uploads"; // 上传文件的目录

    public String uploadFile(MultipartFile file, String subDir) {
        try {
            // 确保子目录存在
            Path subDirPath = Paths.get(uploadDir, subDir);
            if (!Files.exists(subDirPath)) {
                Files.createDirectories(subDirPath);
            }

            // 保存文件
            String fileName = System.currentTimeMillis() + "_" + file.getOriginalFilename();
            Path filePath = subDirPath.resolve(fileName);
            Files.write(filePath, file.getBytes());

            // 返回文件的相对路径
            return subDir + "/" + fileName;
        } catch (IOException e) {
            throw new RuntimeException("文件上传失败", e);
        }
    }
}
