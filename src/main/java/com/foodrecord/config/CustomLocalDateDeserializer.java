package com.foodrecord.config;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;

import java.io.IOException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

public class CustomLocalDateDeserializer extends JsonDeserializer<LocalDate> {

    @Override
    public LocalDate deserialize(JsonParser parser, DeserializationContext ctxt) throws IOException {
        String date = parser.getText();
        try {
            // 支持格式：yyyy-MM-dd 和 yyyy-MM-dd HH:mm:ss
            if (date.matches("\\d{4}-\\d{2}-\\d{2}")) {
                return LocalDate.parse(date, DateTimeFormatter.ofPattern("yyyy-MM-dd"));
            } else if (date.matches("\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}")) {
                return LocalDate.parse(date.substring(0, 10), DateTimeFormatter.ofPattern("yyyy-MM-dd"));
            } else {
                throw new RuntimeException("无法解析日期: " + date);
            }
        } catch (Exception e) {
            throw new RuntimeException("无法解析日期: " + date, e);
        }
    }
}
