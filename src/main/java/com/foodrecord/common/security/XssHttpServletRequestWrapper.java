package com.foodrecord.common.security;

import org.apache.commons.lang3.StringUtils;
import org.apache.commons.text.StringEscapeUtils;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletRequestWrapper;

/**
 * XSS请求包装器
 * 对请求参数进行XSS过滤处理
 */
public class XssHttpServletRequestWrapper extends HttpServletRequestWrapper {
    
    public XssHttpServletRequestWrapper(HttpServletRequest request) {
        super(request);
    }
    
    @Override
    public String getParameter(String name) {
        String value = super.getParameter(name);
        return cleanXss(value);
    }
    
    @Override
    public String[] getParameterValues(String name) {
        String[] values = super.getParameterValues(name);
        if (values == null) {
            return null;
        }
        
        String[] cleanValues = new String[values.length];
        for (int i = 0; i < values.length; i++) {
            cleanValues[i] = cleanXss(values[i]);
        }
        return cleanValues;
    }
    
    @Override
    public String getHeader(String name) {
        String value = super.getHeader(name);
        return cleanXss(value);
    }
    
    /**
     * 清理XSS攻击字符
     * @param value 待清理的字符串
     * @return 清理后的字符串
     */
    private String cleanXss(String value) {
        if (StringUtils.isBlank(value)) {
            return value;
        }
        
        // 使用commons-text进行HTML转义
        value = StringEscapeUtils.escapeHtml4(value);
        
        // 过滤常见的XSS攻击向量
        value = value.replaceAll("(?i)<script.*?>.*?</script.*?>", "")   // 过滤script标签
                    .replaceAll("(?i)<.*?javascript:.*?>.*?</.*?>", "")   // 过滤javascript
                    .replaceAll("(?i)<.*?\\s+on.*?>.*?</.*?>", "");      // 过滤on事件
        
        return value;
    }
} 