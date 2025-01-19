package com.foodrecord.util;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

public class FileSplitter {

    private static final int CHUNK_SIZE = 90 * 1024 * 1024; // 90MB
    public static void splitFile(String inputFilePath, String outputDirPath) throws IOException {
        File inputFile = new File(inputFilePath);
        if (!inputFile.exists()) {
            throw new IOException("Input file does not exist: " + inputFilePath);
        }

        File outputDir = new File(outputDirPath);
        if (!outputDir.exists()) {
            if (!outputDir.mkdirs()) {
                throw new IOException("Failed to create output directory: " + outputDirPath);
            }
        }

        try (FileInputStream fis = new FileInputStream(inputFile)) {
            byte[] buffer = new byte[CHUNK_SIZE];
            int bytesRead;
            int partNumber = 1;

            while ((bytesRead = fis.read(buffer)) != -1) {
                String partFileName = String.format("%s/part_%03d.html", outputDirPath, partNumber++);
                try (FileOutputStream fos = new FileOutputStream(partFileName)) {
                    fos.write(buffer, 0, bytesRead);
                }
            }
        }
    }
}
