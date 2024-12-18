package com.foodrecord.common.utils;

import com.aliyun.oss.ClientException;
import com.aliyun.oss.OSS;
import com.aliyun.oss.OSSClientBuilder;
import com.aliyun.oss.OSSException;
import com.aliyun.oss.model.PutObjectRequest;
import com.aliyun.oss.model.PutObjectResult;
import org.springframework.beans.factory.annotation.Value;

import java.io.InputStream;

public class AliOssUtil {
    @Value("${oss.client.keyId}")
    private static String ACCESS_KEY_ID;

    @Value("${oss.client.keySecret}")
    private static String ACCESS_KEY_SECRET;

    @Value("${oss.client.endPoint}")
    private static String ENDPOINT;

    @Value("${oss.client.bucket}")
    private static String BUCKET_NAME;

//    // Endpoint以华东1（杭州）为例，其它Region请按实际情况填写。
//    private static final String ENDPOINT = "https://oss-cn-beijing.aliyuncs.com";
//    // 从环境变量中获取访问凭证。运行本代码示例之前，请确保已设置环境变量OSS_ACCESS_KEY_ID和OSS_ACCESS_KEY_SECRET。
//    //EnvironmentVariableCredentialsProvider credentialsProvider = CredentialsProviderFactory.newEnvironmentVariableCredentialsProvider();
//    private static final String ACCESS_KEY_ID="LTAI5tPao4rwMV6qSiUkcmvB";
//    private static final String ACCESS_KEY_SECRET="iWU8LraTYPHuuyjo3Wh2SPWXCJ1Y5T";
//    // 填写Bucket名称，例如examplebucket。
//    private static final String BUCKET_NAME = "cetide";

    public static String uploadFile(String objectName, InputStream in) throws Exception {


        // 创建OSSClient实例。
        OSS ossClient = new OSSClientBuilder().build(ENDPOINT,ACCESS_KEY_ID, ACCESS_KEY_SECRET);
        String url = "";
        try {
            // 填写字符串。
            String content = "Hello OSS，你好世界";

            // 创建PutObjectRequest对象。
            PutObjectRequest putObjectRequest = new PutObjectRequest(BUCKET_NAME, objectName, in);

            // 如果需要上传时设置存储类型和访问权限，请参考以下示例代码。
            // ObjectMetadata metadata = new ObjectMetadata();
            // metadata.setHeader(OSSHeaders.OSS_STORAGE_CLASS, StorageClass.Standard.toString());
            // metadata.setObjectAcl(CannedAccessControlList.Private);
            // putObjectRequest.setMetadata(metadata);

            // 上传字符串。
            PutObjectResult result = ossClient.putObject(putObjectRequest);
            //url组成: https://bucket名称.区域节点/objectName
            url = "https://"+BUCKET_NAME+"."+ENDPOINT.substring(ENDPOINT.lastIndexOf("/")+1)+"/"+objectName;
        } catch (OSSException oe) {
            System.out.println("Caught an OSSException, which means your request made it to OSS, "
                    + "but was rejected with an error response for some reason.");
            System.out.println("Error Message:" + oe.getErrorMessage());
            System.out.println("Error Code:" + oe.getErrorCode());
            System.out.println("Request ID:" + oe.getRequestId());
            System.out.println("Host ID:" + oe.getHostId());
        } catch (ClientException ce) {
            System.out.println("Caught an ClientException, which means the client encountered "
                    + "a serious internal problem while trying to communicate with OSS, "
                    + "such as not being able to access the network.");
            System.out.println("Error Message:" + ce.getMessage());
        } finally {
            if (ossClient != null) {
                ossClient.shutdown();
            }
        }

        return url;
    }
}

/**
 *     @PostMapping("/upload")
 *     @ApiOperation(value = "文件上传")
 *     public Result upload(MultipartFile file)throws Exception{
 *         Result result = new Result();
 *         //1.把文件的内容存储到本地磁盘上
 *         String originalFilename = file.getOriginalFilename();
 *         //2.保证文件名是唯一的，从而防止文件被覆盖
 *         String filename = UUID.randomUUID() +originalFilename.substring(originalFilename.lastIndexOf("."));
 *         //3.调用阿里云
 *         String url = AliOssUtil.uploadFile(filename,file.getInputStream());
 *         result.setData(url);
 *         return result;
 *     }
 */