package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Rankings;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

@Mapper
public interface RankingsMapper extends BaseMapper<Rankings> {
    
    List<Rankings> selectByRankType(
        @Param("rankType") String rankType,
        @Param("limit") Integer limit
    );
    
    Rankings selectByFoodIdAndType(
        @Param("foodId") Long foodId,
        @Param("rankType") String rankType
    );
    
    void updateRankings(
        @Param("rankType") String rankType,
        @Param("foodId") Long foodId,
        @Param("score") Double score
    );
} 