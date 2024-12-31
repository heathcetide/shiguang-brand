package com.foodrecord.common.monitor;

import com.foodrecord.core.degradation.ServiceMetrics;
import com.foodrecord.core.flow.performance.PerformanceMetrics;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;

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


    public ServiceMetrics getMetrics(String serviceId) {
        double totalRequests = getCounterValue(serviceId + ".requests.total");
        double failedRequests = getCounterValue(serviceId + ".requests.error");
        double averageResponseTime = getTimerValue(serviceId + ".response.time");
        Map<String, Double> errorRates = getErrorRates(serviceId); // 需要定义获取错误率的方法
        PerformanceMetrics performance = getPerformanceMetrics(serviceId); // 需要定义获取性能指标的方法
        LocalDateTime collectionTime = LocalDateTime.now();

        return new ServiceMetrics(
                serviceId,                    // 服务 ID
                performance,                  // 性能指标对象
                errorRates,                   // 错误率映射
                collectionTime,               // 数据采集时间
                (long) totalRequests,         // 总请求数
                (long) failedRequests,        // 失败请求数
                averageResponseTime           // 平均响应时间
        );
    }


    // 获取计数器的值
    private double getCounterValue(String counterName) {
        Counter counter = counters.get(counterName);
        return counter != null ? counter.count() : 0.0;
    }

    private double getTimerValue(String timerName) {
        Timer timer = meterRegistry.find(timerName).timer();
        return timer != null ? timer.mean(TimeUnit.MILLISECONDS) : 0.0;
    }

    private Map<String, Double> getErrorRates(String serviceId) {
        // 根据你的业务逻辑，获取该服务的错误率数据
        return Map.of("default", getCounterValue(serviceId + ".requests.error") / Math.max(1, getCounterValue(serviceId + ".requests.total")));
    }

    private PerformanceMetrics getPerformanceMetrics(String serviceId) {
        // 根据你的业务逻辑，构建并返回 PerformanceMetrics 对象
        return new PerformanceMetrics(
                getTimerValue(serviceId + ".latency.p50"),
                getTimerValue(serviceId + ".latency.p90"),
                getTimerValue(serviceId + ".latency.p99"),
                1.0 - getErrorRate(serviceId), // 成功率
                getCounterValue(serviceId + ".requests.total"),
                getErrorRate(serviceId)        // 错误率
        );
    }

    private double getErrorRate(String serviceId) {
        double total = getCounterValue(serviceId + ".requests.total");
        double errors = getCounterValue(serviceId + ".requests.error");
        return total == 0 ? 0 : errors / total;
    }

} 
 