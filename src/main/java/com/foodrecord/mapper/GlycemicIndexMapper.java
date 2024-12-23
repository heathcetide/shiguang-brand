package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.GlycemicIndex;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

@Mapper
public interface GlycemicIndexMapper extends BaseMapper<GlycemicIndex> {
    
    GlycemicIndex selectByFoodId(@Param("foodId") Long foodId);
    
    List<GlycemicIndex> selectByGIRange(
        @Param("minValue") Float minValue,
        @Param("maxValue") Float maxValue
    );
    
    List<GlycemicIndex> selectByGLRange(
        @Param("minValue") Float minValue,
        @Param("maxValue") Float maxValue
    );
    
    List<GlycemicIndex> selectByGILabel(@Param("giLabel") String giLabel);
    
    List<GlycemicIndex> selectByGLLabel(@Param("glLabel") String glLabel);

    void batchInsert(List<GlycemicIndex> glycemicIndexList);
} 