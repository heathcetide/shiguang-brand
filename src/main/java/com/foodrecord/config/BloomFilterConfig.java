package com.foodrecord.config;

import com.google.common.hash.BloomFilter;
import com.google.common.hash.Funnel;

import java.util.Collection;

public class BloomFilterConfig {

    private static final int EXPECTED_INSERTIONS = 50000; // 预期插入的数量
    private static final double FPP = 0.01; // 误判率

    private static final Funnel<Long> FUNNEL = (from, into) -> into.putLong(from);

    private static final int numBits = (int) (-EXPECTED_INSERTIONS * Math.log(FPP) / (Math.log(2) * Math.log(2)));

    private static final int numHashFunctions = (int) (numBits * Math.log(2) / EXPECTED_INSERTIONS);

    private static final BloomFilter<Long> bloomFilter = BloomFilter.create(FUNNEL, EXPECTED_INSERTIONS, FPP);

    /**
     * 判断是否可能存在某个 id
     * @param id 对象id
     * @return 是都存在该id
     */
    public static boolean mightContain(long id) {
        return bloomFilter.mightContain(id);
    }

    /**
     * 插入单个 id 到布隆过滤器
     * @param id 对象id
     */
    public static void put(long id) {
        bloomFilter.put(id);
    }

    /**
     * 批量插入多个 id 到布隆过滤器
     * @param ids 对象id集合
     */
    public static void putAll(Collection<Long> ids) {
        for (Long id : ids) {
            bloomFilter.put(id);  // 遍历并逐个插入
        }
    }
}