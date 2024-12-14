package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Minerals;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Optional;

@Mapper
public interface MineralsMapper extends BaseMapper<Minerals> {
    /**
     * 根据食物ID查找矿物质信息
     */
    @Select("SELECT * FROM minerals WHERE food_id = #{foodId}")
    Optional<Minerals> findByFoodId(@Param("foodId") Long foodId);

    /**
     * 删除矿物质信息
     */
    @Delete("DELETE FROM minerals WHERE id = #{id}")
    int deleteMinerals(@Param("id") Long id);
} 