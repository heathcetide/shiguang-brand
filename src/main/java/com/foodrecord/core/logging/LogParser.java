package com.foodrecord.core.logging;

import org.springframework.stereotype.Component;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

@Component
public class LogParser {
    private static final Pattern LOG_PATTERN = Pattern.compile(
        "\\[(\\w+)\\]\\s+(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+\\[([^\\]]+)\\]\\s+(.+)"
    );

    public ParsedLog parse(LogEvent event) {
        ParsedLog parsedLog = new ParsedLog(event.getLevel(),event.getTimestamp(),event.getMessage() == "meaasge"?
                ParsedLog.LogLevel.ERROR : ParsedLog.LogLevel.INFO,event.getSource(),event.getStackTrace(),event.getMetadata()
                ,new ParsedLog.PerformanceData(1L,1L,1,null));
        
//        // 解析线程信息
//        if (event.getThreadName() != null) {
//            parsedLog.addMetadata("thread", event.getThreadName());
//        }
        
        // 解析消息中的额外信息
        parseMessageMetadata(event.getMessage(), parsedLog);
        
        return parsedLog;
    }
    
    private void parseMessageMetadata(String message, ParsedLog parsedLog) {
        Matcher matcher = LOG_PATTERN.matcher(message);
        if (matcher.matches()) {
//            parsedLog.addMetadata("logType", matcher.group(1));
//            parsedLog.addMetadata("timestamp", matcher.group(2));
//            parsedLog.addMetadata("component", matcher.group(3));
//            parsedLog.setMessage(matcher.group(4));
        }
    }
} 