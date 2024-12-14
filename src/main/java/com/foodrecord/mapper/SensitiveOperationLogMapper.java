package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.SensitiveOperationLog;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface SensitiveOperationLogMapper extends BaseMapper<SensitiveOperationLog> {

    /**
     * 根据用户ID查询最近的操作日志
     *
     * @param userId 用户ID
     * @param limit  查询的记录数
     * @return 最近的操作日志列表
     */
    @Select("SELECT * FROM sensitive_operation_log WHERE user_id = #{userId} ORDER BY operation_time DESC LIMIT #{limit}")
    List<SensitiveOperationLog> selectRecentByUserId(@Param("userId") Long userId, @Param("limit") int limit);
}
