package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.entity.User;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Optional;

@Mapper
public interface UserMapper extends BaseMapper<User> {

    /**
     * 根据用户名检查用户是否存在
     * @param username 用户名
     * @return 是否存在
     */
    boolean existsByUsername(@Param("username") String username);
    /**
     * 根据用户名查询用户
     * @param username 用户名
     * @return 用户对象
     */
    User selectByUsername(@Param("username") String username);

    /**
     * 检查邮箱是否存在
     * @param email 邮箱
     * @return 是否存在
     */
    boolean existsByEmail(@Param("email") String email);

    /**
     * 检查手机号是否存在
     * @param phone 手机号
     * @return 是否存在
     */
    boolean existsByPhone(@Param("phone") String phone);

    /**
     * 根据 ID 查找用户
     */
    @Select("SELECT * FROM user WHERE id = #{id}")
    Optional<User> findById(@Param("id") Long id);

}