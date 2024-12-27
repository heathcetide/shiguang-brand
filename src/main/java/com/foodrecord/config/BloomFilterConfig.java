package com.foodrecord.config;

import com.google.common.hash.Funnel;

public class BloomFilterConfig {

    private static final int EXPECTED_INSERTIONS = 50000; // 预期插入的数量
    private static final double FPP = 0.01; // 误判率

    private static final Funnel<Long> FUNNEL = (from, into) -> into.putLong(from);

    // 计算位数，改为直接计算无需要额外的 RoundingMode 参数
    private static final int numBits = (int) (-EXPECTED_INSERTIONS * Math.log(FPP) / (Math.log(2) * Math.log(2)));

    private static final int numHashFunctions = (int) (numBits * Math.log(2) / EXPECTED_INSERTIONS);

    private static final com.google.common.hash.BloomFilter<Long> bloomFilter =
            com.google.common.hash.BloomFilter.create(FUNNEL, EXPECTED_INSERTIONS, FPP);

    public static boolean mightContain(long id) {
        return bloomFilter.mightContain(id);
    }

    public static void put(long id) {
        bloomFilter.put(id);
    }
}
