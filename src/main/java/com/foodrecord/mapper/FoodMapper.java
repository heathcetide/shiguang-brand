package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.Food;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Mapper
public interface FoodMapper extends BaseMapper<Food> {
    
    Food selectByCode(@Param("code") String code);
    
    List<Food> searchByName(@Param("name") String name);
    
    List<Food> selectByHealthLight(@Param("healthLight") Integer healthLight);
    
    Boolean checkCodeExists(@Param("code") String code);

    // 添加以下方法
    List<Food> selectByCategory(@Param("category") String category);

    boolean existsByCode(@Param("code") String code);

    List<Food> selectHotFoods(int limit);

    List<Food> searchFoodsByName(String name);

    Food findById(@Param("id") Long id);

    void batchInsert(@Param("foodList") List<Food> foodList);

    List<Food> searchFoods(String keyword);

    Page<Food> selectFoods(Page<Food> page, String keyword);

    void batchDelete(List<Long> foodIds);

    @Select("SELECT #{field}, COUNT(*) as total FROM food_basic group by #{field} order by total desc")
    List<Map<String, Object>> selectCountByField(String field);

    @Select("select * from food_basic limit 600")
    List<Food> selectAllFoods();

    /**
     * 获取分类统计
     */
    @Select("SELECT category, COUNT(*) as count FROM foods GROUP BY category")
    Map<String, Long> selectCategoryStats();

    @Select("SELECT * FROM food_basic LIMIT #{pageSize} OFFSET #{offset}")
    List<Food> selectFoodsByPage(@Param("offset") int offset, @Param("pageSize") int pageSize);

    @Select("SELECT * FROM food_basic WHERE id = #{foodId}")
    Food selectFoodById(Long foodId);

    @Select("SELECT COUNT(*) FROM food_basic")
    long countFoods();
}