package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Scene;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

@Mapper
public interface SceneMapper extends BaseMapper<Scene> {
    
    List<Scene> selectByFoodId(@Param("foodId") Long foodId);
    
    List<Scene> selectBySceneType(@Param("scene") String scene);
    
    List<Scene> selectBySuitability(
        @Param("scene") String scene,
        @Param("suitable") Boolean suitable
    );
    
    List<Scene> selectByTag(@Param("tag") String tag);
} 