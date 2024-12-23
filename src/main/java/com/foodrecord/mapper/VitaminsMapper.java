package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.Vitamins;
import org.apache.ibatis.annotations.*;

import java.util.List;

@Mapper
public interface VitaminsMapper extends BaseMapper<Vitamins> {
    /**
     * 根据食物ID查找维生素信息
     */
    @Select("SELECT * FROM vitamins WHERE food_id = #{foodId}")
    Vitamins findByFoodId(@Param("foodId") Long foodId);

    /**
     * 插入维生素信息
     */
    @Insert("INSERT INTO vitamins (food_id, vitamin_a, carotene, vitamin_d, vitamin_e, thiamine, lactoflavin, vitamin_c, niacin, retinol) " +
            "VALUES (#{food.id}, #{vitaminA}, #{carotene}, #{vitaminD}, #{vitaminE}, #{thiamine}, #{lactoflavin}, #{vitaminC}, #{niacin}, #{retinol})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(Vitamins vitamins);

    /**
     * 删除维生素信息
     */
    @Delete("DELETE FROM vitamins WHERE id = #{id}")
    int deleteVitamins(@Param("id") Long id);

    void batchInsert(List<Vitamins> vitaminsList);
}