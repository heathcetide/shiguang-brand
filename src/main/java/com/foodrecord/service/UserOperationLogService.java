package com.foodrecord.service;


import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.UserOperationLog;

import java.util.List;

public interface UserOperationLogService extends IService<UserOperationLog> {
    void addOperationLog(UserOperationLog log); // 添加日志

    List<UserOperationLog> getAllLogs(); // 获取所有日志

    Page<UserOperationLog> getLogsByUserId(Long userId, int page, int size); // 分页获取用户日志

    void deleteLogsByUserId(Long userId); // 删除用户日志
}
