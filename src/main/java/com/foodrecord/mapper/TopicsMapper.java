package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Topics;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

/**
* @author Lenovo
* @description 针对表【topics】的数据库操作Mapper
* @createDate 2024-12-02 21:47:52
* @Entity com.cetide.cecomment.model.entity.Topics
*/
@Mapper
public interface TopicsMapper extends BaseMapper<Topics> {
    List<Topics> selectList();

    @Select("SELECT * FROM topics WHERE name LIKE #{name}")
    List<Topics> selectByName(String name);

    @Insert("INSERT INTO topics (name, popularity) VALUES (#{name}, #{popularity})")
    int save(Topics topic);

    @Select("select * from topics where name = #{name}")
    Topics selectTopicsByName(String name);

    @Select("select * from topics where id = #{id}")
    Topics selectTopicById(Long id);
}




