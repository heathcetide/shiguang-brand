package com.foodrecord.core.flow.condition;

import org.springframework.expression.Expression;
import org.springframework.expression.ExpressionParser;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;
import java.util.Map;

public class SpELFlowCondition implements FlowCondition {
    private final String expression;
    private final Expression parsedExpression;
    
    public SpELFlowCondition(String expression) {
        this.expression = expression;
        ExpressionParser parser = new SpelExpressionParser();
        this.parsedExpression = parser.parseExpression(expression);
    }
    
    @Override
    public boolean evaluate(Map<String, Object> context) {
        StandardEvaluationContext evaluationContext = new StandardEvaluationContext();
        context.forEach(evaluationContext::setVariable);
        return Boolean.TRUE.equals(parsedExpression.getValue(evaluationContext, Boolean.class));
    }
    
    @Override
    public String getExpression() {
        return expression;
    }
} 