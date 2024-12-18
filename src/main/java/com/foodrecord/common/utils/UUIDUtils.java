package com.foodrecord.common.utils;

import java.util.UUID;

/**
 * @Author songchuanming
 * @DATE 2020/6/11.
 */
public class UUIDUtils {
    public static final String getUUID() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
//这段代码是一个Java类，名为UUIDUtils。这个类中有一个静态方法getUUID()，用于生成一个不带连字符（"-"）的UUID字符串。
//在这个代码中，UUID.randomUUID().toString()会生成一个标准的UUID字符串，形如550e8400-e29b-41d4-a716-446655440000。
// 然后，replace("-", "")将这个字符串中的连字符去掉，得到一个没有连字符的UUID字符串，形如550e8400e29b41d4a716446655440000。