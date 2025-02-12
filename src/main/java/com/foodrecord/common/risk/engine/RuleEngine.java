//package com.foodrecord.common.risk.engine;
//
//import com.foodrecord.risk.model.RiskContext;
//import com.foodrecord.risk.model.RiskRule;
//import org.springframework.expression.Expression;
//import org.springframework.expression.ExpressionParser;
//import org.springframework.expression.spel.standard.SpelExpressionParser;
//import org.springframework.expression.spel.support.StandardEvaluationContext;
//import org.springframework.stereotype.Component;
//
//@Component
//public class RuleEngine {
//
//    private final ExpressionParser parser = new SpelExpressionParser();
//
//    /**
//     * 评估规则
//     */
//    public boolean evaluate(RiskRule rule, RiskContext context) {
//        try {
//            // 1. 解析规则条件
//            Expression expression = parser.parseExpression(rule.getCondition());
//
//            // 2. 创建评估上下文
//            StandardEvaluationContext evalContext = new StandardEvaluationContext();
//            evalContext.setVariable("context", context);
//            evalContext.setVariable("properties", context.getProperties());
//
//            // 3. 评估规则
//            return Boolean.TRUE.equals(expression.getValue(evalContext, Boolean.class));
//
//        } catch (Exception e) {
//            System.out.println("规则评估失败: " + e.getMessage());
//            return false;
//        }
//    }
//}