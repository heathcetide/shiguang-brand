package com.foodrecord.mapper;

import com.foodrecord.model.entity.UserLevels;
import org.apache.ibatis.annotations.*;

import java.util.List;

public interface UserLevelsMapper {

    @Insert("INSERT INTO user_levels (user_id, level_id, level_points) VALUES (#{userId}, #{levelId}, #{levelPoints})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    void insert(UserLevels userLevel);

    @Select("SELECT * FROM user_levels WHERE id = #{id}")
    UserLevels selectById(Long id);

    @Select("SELECT * FROM user_levels WHERE user_id = #{userId}")
    UserLevels selectByUserId(Long userId);

    @Select("SELECT * FROM user_levels")
    List<UserLevels> selectAll();

    @Update("UPDATE user_levels SET user_id = #{userId}, level_id = #{levelId}, level_points = #{levelPoints} WHERE id = #{id}")
    void update(UserLevels userLevel);

    @Delete("DELETE FROM user_levels WHERE id = #{id}")
    void delete(Long id);
}
