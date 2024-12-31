package com.foodrecord.common.monitor;

import com.foodrecord.core.flow.performance.PerformanceMetrics;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 性能监控切面
 */
@Aspect
@Component
public class PerformanceMonitor {
    private final MeterRegistry meterRegistry;

    public PerformanceMonitor(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @Around("@annotation(com.foodrecord.common.monitor.MonitorPerformance)")
    public Object monitorPerformance(ProceedingJoinPoint joinPoint) throws Throwable {
        String methodName = joinPoint.getSignature().toShortString();
        Timer timer = Timer.builder("method.execution")
                .tag("method", methodName)
                .register(meterRegistry);

        long startTime = System.nanoTime();
        try {
            return joinPoint.proceed();
        } finally {
            long duration = System.nanoTime() - startTime;
            timer.record(duration, TimeUnit.NANOSECONDS);

            if (duration > TimeUnit.SECONDS.toNanos(1)) { // 超过1秒记录警告
                System.out.println("方法执行时间过长: {} - {}ms" + methodName + duration / 1_000_000);
            }
        }
    }

    public Map<DataSource, PerformanceMetrics> getCurrentMetrics() {
        Map<DataSource, PerformanceMetrics> metrics = new HashMap<>();

        meterRegistry.getMeters().forEach(meter -> {
            String dataSourceName = meter.getId().getTag("datasource");
            if (dataSourceName != null) {
                // 获取性能指标
                double latencyP50 = getTimerValue("latency.p50", dataSourceName, TimeUnit.MILLISECONDS);
                double latencyP90 = getPercentileValue("latency", dataSourceName, 0.9, TimeUnit.MILLISECONDS);
                double latencyP99 = getPercentileValue("latency", dataSourceName, 0.99, TimeUnit.MILLISECONDS);
                double successRate = getGaugeValue("success.rate", dataSourceName);
                double throughput = getCounterValue("throughput", dataSourceName);
                double errorRate = getCounterValue("error.rate", dataSourceName);

                // 创建 PerformanceMetrics 对象
                PerformanceMetrics performanceMetrics = new PerformanceMetrics(
                        latencyP50,
                        latencyP90,
                        latencyP99,
                        successRate,
                        throughput,
                        errorRate
                );

                metrics.put(getDataSourceByName(dataSourceName), performanceMetrics);
            }
        });

        return metrics;
    }

    // 获取计时器平均值
    private double getTimerValue(String timerName, String dataSourceName, TimeUnit timeUnit) {
        Timer timer = meterRegistry.find(timerName).tags("datasource", dataSourceName).timer();
        return timer != null ? timer.mean(timeUnit) : 0.0;
    }

    // 获取计时器指定百分位值
    private double getPercentileValue(String timerName, String dataSourceName, double percentile, TimeUnit timeUnit) {
        Timer timer = meterRegistry.find(timerName).tags("datasource", dataSourceName).timer();
        if (timer != null && timer.takeSnapshot().percentileValues().length > 0) {
            return timer.takeSnapshot().percentileValues()[0].value(timeUnit);
        }
        return 0.0;
    }

    // 获取 Gauge 值
    private double getGaugeValue(String gaugeName, String dataSourceName) {
        Gauge gauge = meterRegistry.find(gaugeName).tags("datasource", dataSourceName).gauge();
        return gauge != null ? gauge.value() : 0.0;
    }

    // 获取 Counter 值
    private double getCounterValue(String counterName, String dataSourceName) {
        Counter counter = meterRegistry.find(counterName).tags("datasource", dataSourceName).counter();
        return counter != null ? counter.count() : 0.0;
    }


    private DataSource getDataSourceByName(String dataSourceName) {
        Map<String, DataSource> dataSourceMap = getDataSourceMap();
        return dataSourceMap.get(dataSourceName);
    }

    private Map<String, DataSource> getDataSourceMap() {
        // 返回实际的数据源映射
        return new HashMap<>();
    }
}
