package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.UserOperationLog;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface UserOperationLogMapper extends BaseMapper<UserOperationLog> {
}