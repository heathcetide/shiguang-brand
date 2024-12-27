package com.foodrecord.common.monitor;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * 监控指标收集器
 */
@Component
public class
MetricsCollector {
    private final MeterRegistry meterRegistry;
    private final ConcurrentMap<String, Counter> counters = new ConcurrentHashMap<>();

    public MetricsCollector(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @PostConstruct
    public void init() {
        // 初始化一些基础计数器
        registerCounter("api.requests.total", "API请求总数");
        registerCounter("api.requests.error", "API错误请求数");
        registerCounter("user.login.success", "用户登录成功次数");
        registerCounter("user.login.failure", "用户登录失败次数");
    }
    
    /**
     * 注册计数器
     */
    public Counter registerCounter(String name, String description) {
        Counter counter = Counter.builder(name)
            .description(description)
            .register(meterRegistry);
        counters.put(name, counter);
        return counter;
    }
    
    /**
     * 增加计数
     */
    public void increment(String name) {
        Counter counter = counters.get(name);
        if (counter != null) {
            counter.increment();
        }
    }
    
    /**
     * 增加指定数量
     */
    public void increment(String name, double amount) {
        Counter counter = counters.get(name);
        if (counter != null) {
            counter.increment(amount);
        }
    }
} 
 