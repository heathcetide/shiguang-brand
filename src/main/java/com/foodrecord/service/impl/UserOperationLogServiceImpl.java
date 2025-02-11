package com.foodrecord.service.impl;


import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.foodrecord.mapper.UserOperationLogMapper;
//import com.foodrecord.messaging.producer.UserOperationLogProducer;
import com.foodrecord.model.entity.UserOperationLog;
import com.foodrecord.service.UserOperationLogService;
import org.springframework.stereotype.Service;

import java.util.List;


@Service
public class UserOperationLogServiceImpl extends ServiceImpl<UserOperationLogMapper, UserOperationLog>
        implements UserOperationLogService {

//    @Autowired
//    private UserOperationLogProducer logProducer;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void addOperationLog(UserOperationLog log) {
        try {
            save(log);
            // 将日志转为 JSON 字符串后发送到 Kafka
            String logMessage = objectMapper.writeValueAsString(log);
//            logProducer.sendLog(logMessage);
        } catch (JsonProcessingException e) {
            e.printStackTrace();
        } catch (Exception e){
            e.printStackTrace();
        }
    }

    @Override
    public List<UserOperationLog> getAllLogs() {
        return list(); // 使用 MyBatis-Plus 的 list 方法
    }

    @Override
    public Page<UserOperationLog> getLogsByUserId(Long userId, int page, int size) {
        return lambdaQuery()
                .eq(UserOperationLog::getUserId, userId)
                .page(new Page<>(page, size));
    }

    @Override
    public void deleteLogsByUserId(Long userId) {
        lambdaQuery()
                .eq(UserOperationLog::getUserId, userId);
        this.deleteLogsByUserId(userId);
    }
}
