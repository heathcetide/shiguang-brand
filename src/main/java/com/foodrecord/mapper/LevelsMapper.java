package com.foodrecord.mapper;

import com.foodrecord.model.entity.Levels;
import org.apache.ibatis.annotations.*;

import java.util.List;

public interface LevelsMapper {

    @Insert("INSERT INTO levels (level_name, level_description, min_points, max_points) VALUES (#{levelName}, #{levelDescription}, #{minPoints}, #{maxPoints})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    void insert(Levels level);

    @Select("SELECT * FROM levels WHERE id = #{id}")
    Levels selectById(Long id);

    @Select("SELECT * FROM levels")
    List<Levels> selectAll();

    @Update("UPDATE levels SET level_name = #{levelName}, level_description = #{levelDescription}, min_points = #{minPoints}, max_points = #{maxPoints} WHERE id = #{id}")
    void update(Levels level);

    @Delete("DELETE FROM levels WHERE id = #{id}")
    void delete(Long id);
}
