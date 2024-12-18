package com.foodrecord.common.utils;

import com.qcloud.cos.COSClient;
import com.qcloud.cos.ClientConfig;
import com.qcloud.cos.auth.BasicSessionCredentials;
import com.qcloud.cos.exception.CosClientException;
import com.qcloud.cos.model.PutObjectRequest;
import com.qcloud.cos.model.PutObjectResult;
import com.qcloud.cos.region.Region;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.URL;

@Component
public class CosUtils {
    
    @Value("${cos.client.accessKey}")
    private String accessKey;
    
    @Value("${cos.client.secretKey}")
    private String secretKey;
    
    @Value("${cos.client.region}")
    private String regionName;
    
    @Value("${cos.client.bucket}")
    private static String bucketName;

    private static COSClient cosClient;
    
    @PostConstruct
    public void init() {
        // 初始化 COS 客户端
        BasicSessionCredentials cred = new BasicSessionCredentials(accessKey, secretKey, "TOKEN");
        Region region = new Region(regionName);
        ClientConfig clientConfig = new ClientConfig(region);
        cosClient = new COSClient(cred, clientConfig);
    }

    public static String uploadFile(File file, String fileName) throws CosClientException, IOException {
        // 创建 PutObjectRequest 对象
        FileInputStream inputStream = new FileInputStream(file);
        PutObjectRequest putObjectRequest = new PutObjectRequest(bucketName, fileName, inputStream, null);

        // 执行上传操作
        PutObjectResult putObjectResult = cosClient.putObject(putObjectRequest);

        // 获取文件的 URL
        URL objectUrl = cosClient.getObjectUrl(bucketName, fileName);

        // 关闭输入流
        inputStream.close();

        return objectUrl.toString();
    }

    public boolean deleteFile(String fileName) {
        try {
            cosClient.deleteObject(bucketName, fileName);
            return true;
        } catch (CosClientException cce) {
            cce.printStackTrace();
            return false;
        }
    }
}
