

package com.foodrecord.common.utils;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.client.j2se.MatrixToImageConfig;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import com.google.zxing.qrcode.QRCodeReader;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.client.j2se.BufferedImageLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.Result;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.nio.file.Path;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

public class QRCodeUtils {

    /**
     * 生成二维码图片并返回Base64编码
     *
     * @param content 二维码内容
     * @param width   宽度
     * @param height  高度
     * @return Base64编码的二维码图像q
     */
    public static String generateQRCodeBase64(String content, int width, int height) throws WriterException, IOException {
        QRCodeWriter writer = new QRCodeWriter();
        BitMatrix bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, width, height);

        ByteArrayOutputStream os = new ByteArrayOutputStream();
        BufferedImage bufferedImage = MatrixToImageWriter.toBufferedImage(bitMatrix);
        ImageIO.write(bufferedImage, "png", os);

        return "data:image/png;base64," + Base64.getEncoder().encodeToString(os.toByteArray());
    }

    /**
     * 生成二维码并保存到指定路径
     *
     * @param content  二维码内容
     * @param width    宽度
     * @param height   高度
     * @param filePath 保存路径
     */
    public static void generateQRCodeToFile(String content, int width, int height, String filePath) throws WriterException, IOException {
        QRCodeWriter writer = new QRCodeWriter();
        BitMatrix bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, width, height);
        Path path = new File(filePath).toPath();
        MatrixToImageWriter.writeToPath(bitMatrix, "png", path);
    }

    /**
     * 生成带Logo的二维码
     *
     * @param content  二维码内容
     * @param width    宽度
     * @param height   高度
     * @param logoPath Logo文件路径
     * @return 带Logo的二维码图像
     */
    public static BufferedImage generateQRCodeWithLogo(String content, int width, int height, String logoPath) throws WriterException, IOException {
        QRCodeWriter writer = new QRCodeWriter();
        Map<EncodeHintType, Object> hints = new HashMap<>();
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.H);

        BitMatrix bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, width, height, hints);
        BufferedImage qrImage = MatrixToImageWriter.toBufferedImage(bitMatrix);

        // 添加Logo
        File logoFile = new File(logoPath);
        if (!logoFile.exists()) {
            throw new IOException("Logo file not found at: " + logoPath);
        }
        BufferedImage logo = ImageIO.read(logoFile);

        int logoWidth = qrImage.getWidth() / 5;
        int logoHeight = qrImage.getHeight() / 5;
        int x = (qrImage.getWidth() - logoWidth) / 2;
        int y = (qrImage.getHeight() - logoHeight) / 2;

        Graphics2D graphics = qrImage.createGraphics();
        graphics.drawImage(logo, x, y, logoWidth, logoHeight, null);
        graphics.dispose();

        return qrImage;
    }

    /**
     * 从二维码图片中解析内容
     *
     * @param filePath 二维码图片路径
     * @return 解码后的内容
     */
    public static String decodeQRCode(String filePath) throws Exception {
        File file = new File(filePath);
        if (!file.exists()) {
            throw new IOException("File not found at: " + filePath);
        }

        BufferedImage bufferedImage = ImageIO.read(file);
        BinaryBitmap binaryBitmap = new BinaryBitmap(new HybridBinarizer(new BufferedImageLuminanceSource(bufferedImage)));
        QRCodeReader reader = new QRCodeReader();

        Result result = reader.decode(binaryBitmap);
        return result.getText();
    }

    /**
     * 生成自定义二维码
     *
     * @param content              二维码内容
     * @param width                宽度
     * @param height               高度
     * @param errorCorrectionLevel 容错等级
     * @return 二维码图像
     */
    public static BufferedImage generateCustomQRCode(String content, int width, int height, ErrorCorrectionLevel errorCorrectionLevel) throws WriterException {
        QRCodeWriter writer = new QRCodeWriter();
        Map<EncodeHintType, Object> hints = new HashMap<>();
        hints.put(EncodeHintType.ERROR_CORRECTION, errorCorrectionLevel);

        BitMatrix bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, width, height, hints);
        return MatrixToImageWriter.toBufferedImage(bitMatrix);
    }


    /**
     * 生成自定义颜色的二维码
     *
     * @param content     二维码内容
     * @param width       宽度
     * @param height      高度
     * @param foregroundColor 前景色
     * @param backgroundColor 背景色
     * @return BufferedImage 自定义颜色的二维码
     */
    public static BufferedImage generateQRCodeWithColors(String content, int width, int height, int foregroundColor, int backgroundColor) throws WriterException {
        QRCodeWriter writer = new QRCodeWriter();
        BitMatrix bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, width, height);

        // 自定义颜色配置
        MatrixToImageConfig config = new MatrixToImageConfig(foregroundColor, backgroundColor);
        return MatrixToImageWriter.toBufferedImage(bitMatrix, config);
    }

    /**
     * 生成二维码并保存为SVG格式
     *
     * @param content  二维码内容
     * @param width    宽度
     * @param height   高度
     * @param filePath 保存路径（.svg文件）
     */
    public static void generateQRCodeToSVG(String content, int width, int height, String filePath) throws WriterException, IOException {
        QRCodeWriter writer = new QRCodeWriter();
        BitMatrix bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, width, height);

        // 输出为SVG格式
        try (FileWriter writerSVG = new FileWriter(filePath)) {
            writerSVG.write(bitMatrixToSVG(bitMatrix));
        }
    }

    /**
     * 将BitMatrix转换为SVG格式字符串
     */
    private static String bitMatrixToSVG(BitMatrix bitMatrix) {
        int width = bitMatrix.getWidth();
        int height = bitMatrix.getHeight();
        StringBuilder svgBuilder = new StringBuilder();

        svgBuilder.append("<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" ");
        svgBuilder.append("width=\"").append(width).append("\" height=\"").append(height).append("\">");
        svgBuilder.append("<rect width=\"100%\" height=\"100%\" fill=\"white\"/>");

        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                if (bitMatrix.get(x, y)) {
                    svgBuilder.append("<rect x=\"").append(x).append("\" y=\"").append(y)
                            .append("\" width=\"1\" height=\"1\" fill=\"black\"/>");
                }
            }
        }
        svgBuilder.append("</svg>");
        return svgBuilder.toString();
    }

    /**
     * 从InputStream中解析二维码内容
     *
     * @param inputStream 二维码图片的输入流
     * @return 解码后的内容
     */
    public static String decodeQRCodeFromStream(InputStream inputStream) throws Exception {
        BufferedImage bufferedImage = ImageIO.read(inputStream);
        BinaryBitmap binaryBitmap = new BinaryBitmap(new HybridBinarizer(new BufferedImageLuminanceSource(bufferedImage)));
        QRCodeReader reader = new QRCodeReader();
        Result result = reader.decode(binaryBitmap);
        return result.getText();
    }

    /**
     * 批量生成二维码并保存到文件夹
     *
     * @param contents  二维码内容数组
     * @param width     宽度
     * @param height    高度
     * @param folderPath 保存文件夹路径
     */
    public static void batchGenerateQRCodeToFolder(String[] contents, int width, int height, String folderPath) throws WriterException, IOException {
        File folder = new File(folderPath);
        if (!folder.exists()) {
            folder.mkdirs();
        }

        for (int i = 0; i < contents.length; i++) {
            String content = contents[i];
            String filePath = folderPath + "/qrcode_" + i + ".png";
            generateQRCodeToFile(content, width, height, filePath);
        }
    }

    /**
     * 自动调整二维码容错级别并生成二维码
     *
     * @param content 二维码内容
     * @param width   宽度
     * @param height  高度
     * @return BufferedImage 容错级别调整后的二维码
     */
    public static BufferedImage generateQRCodeWithAdaptiveErrorCorrection(String content, int width, int height) throws WriterException {
        // 容错级别自动调整
        ErrorCorrectionLevel errorCorrectionLevel = content.length() > 100 ? ErrorCorrectionLevel.L : ErrorCorrectionLevel.H;

        QRCodeWriter writer = new QRCodeWriter();
        Map<EncodeHintType, Object> hints = new HashMap<>();
        hints.put(EncodeHintType.ERROR_CORRECTION, errorCorrectionLevel);

        BitMatrix bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, width, height, hints);
        return MatrixToImageWriter.toBufferedImage(bitMatrix);
    }

    public static void main(String[] args) {
        try {
            // 示例1: 生成Base64二维码
            String base64QRCode = generateQRCodeBase64("https://www.google.com", 300, 300);
            System.out.println("Base64 QR Code: " + base64QRCode);

            // 示例2: 生成并保存二维码到文件
            generateQRCodeToFile("https://www.google.com", 300, 300, "./qrcode.png");

            // 示例3: 生成带Logo的二维码
            BufferedImage qrWithLogo = generateQRCodeWithLogo("https://www.google.com", 300, 300, "./logo.png");
            ImageIO.write(qrWithLogo, "png", new File("./qrcode_with_logo.png"));

            // 示例4: 从二维码中解析内容
            String decodedContent = decodeQRCode("./qrcode.png");
            System.out.println("Decoded QR Code Content: " + decodedContent);

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}

