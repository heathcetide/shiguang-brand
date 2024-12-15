package com.foodrecord.monitor;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.stereotype.Component;

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

    @Around("@annotation(com.foodrecord.monitor.MonitorPerformance)")
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
                System.out.println("方法执行时间过长: {} - {}ms"+ methodName+ duration / 1_000_000);
            }
        }
    }
} 