package com.foodrecord.risk;

import com.foodrecord.risk.enums.RiskLevel;
import com.foodrecord.risk.model.*;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@Service
public class RiskControlService {

    @Resource
    private RedisTemplate<String, Object> redisTemplate;

    private static final String RISK_SCORE_KEY = "risk:score:";
    private static final String RISK_RULE_KEY = "risk:rule:";
    private static final String RISK_LOG_KEY = "risk:log:";
    private static final String RISK_BLOCK_KEY = "risk:block:";

    /**
     * 风险评估
     */
    public RiskAssessment assessRisk(RiskContext context) {
        // 1. 加载适用的规则
        List<RiskRule> rules = loadApplicableRules(context.getScenario());
        
        // 2. 计算风险分数
        double totalScore = 0;
        List<RiskViolation> violations = new ArrayList<>();
        
        for (RiskRule rule : rules) {
            if (rule.evaluate(context)) {
                totalScore += rule.getScore();
                violations.add(new RiskViolation(rule, context));
            }
        }
        
        // 3. 确定风险等级
        RiskLevel riskLevel = determineRiskLevel(totalScore);
        
        // 4. 记录风险评估结果
        logRiskAssessment(context, totalScore, riskLevel, violations);
        
        return new RiskAssessment(totalScore, riskLevel, violations);
    }

    /**
     * 实时规则更新
     */
    public void updateRule(RiskRule rule) {
        String key = RISK_RULE_KEY + rule.getId();
        redisTemplate.opsForValue().set(key, rule);
        
        // 通知其他节点规则已更新
        redisTemplate.convertAndSend("risk:rule:update", rule.getId());
    }

    /**
     * 风险监控
     */
    public RiskMetrics getRiskMetrics(String scenario, TimeUnit unit, int windowSize) {
        long now = System.currentTimeMillis();
        long window = unit.toMillis(windowSize);
        String key = RISK_LOG_KEY + scenario;
        
        // 获取时间窗口内的风险事件
        List<RiskEvent> events = redisTemplate.opsForZSet()
            .rangeByScore(key, now - window, now)
            .stream()
            .map(this::parseRiskEvent)
            .collect(Collectors.toList());
        
        // 计算风险指标
        return calculateRiskMetrics(events);
    }

    /**
     * 风险处置
     */
    public void handleRiskViolation(RiskViolation violation) {
        RiskRule rule = violation.getRule();
        RiskContext context = violation.getContext();
        
        // 1. 执行风险控制动作
        switch (rule.getAction()) {
            case BLOCK:
                blockUser(context.getUserId());
                break;
            case LIMIT:
                limitUserActions(context.getUserId(), rule.getLimitDuration());
                break;
            case WARN:
                sendWarning(context);
                break;
            default:
                break;
        }
        
        // 2. 记录处置结果
        logRiskAction(violation);
    }

    private List<RiskRule> loadApplicableRules(String scenario) {
        // 从Redis加载适用的规则
        return redisTemplate.opsForList()
            .range(RISK_RULE_KEY + scenario, 0, -1)
            .stream()
            .map(obj -> (RiskRule) obj)
            .collect(Collectors.toList());
    }

    private RiskLevel determineRiskLevel(double score) {
        if (score >= 80) return RiskLevel.HIGH;
        if (score >= 50) return RiskLevel.MEDIUM;
        return RiskLevel.LOW;
    }

    private void logRiskAssessment(RiskContext context, double score, 
                                 RiskLevel level, List<RiskViolation> violations) {
        RiskEvent event = new RiskEvent(
            context,
            score,
            level,
            violations,
            System.currentTimeMillis()
        );
        
        String key = RISK_LOG_KEY + context.getScenario();
        redisTemplate.opsForZSet().add(key, event, event.getTimestamp());
        redisTemplate.expire(key, 30, TimeUnit.DAYS);
    }

    private void blockUser(Long userId) {
        redisTemplate.opsForValue().set(
            RISK_BLOCK_KEY + userId,
            true,
            24,
            TimeUnit.HOURS
        );
    }

    private void limitUserActions(Long userId, long duration) {
        redisTemplate.opsForValue().set(
            RISK_BLOCK_KEY + "limit:" + userId,
            true,
            duration,
            TimeUnit.MINUTES
        );
    }

    private void sendWarning(RiskContext context) {
        // TODO: 实现风险预警通知
    }

    private RiskEvent parseRiskEvent(Object obj) {
        // TODO: 实现风险事件解析
        return null;
    }

    private RiskMetrics calculateRiskMetrics(List<RiskEvent> events) {
        // TODO: 实现风险指标计算
        return null;
    }

    private void logRiskAction(RiskViolation violation) {
        // TODO: 实现风险处置日志记录
    }
} 