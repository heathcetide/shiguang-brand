package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.params.UserCheckParams;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;
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
    @Select("SELECT * FROM users WHERE id = #{id}")
    Optional<User> findById(@Param("id") Long id);

    /**
     * 更新上一次登录时间
     * @param id
     * @return
     */
    @Update("update users set last_login_time = NOW() where id = #{id}")
    boolean setLastLoginTime(Long id);

    /**
     * 查询用户总数
     */
    @Select("SELECT COUNT(*) FROM users WHERE deleted = 0")
    Long selectUserCount();

    /**
     * 查询热门用户（示例规则：按关注数排序）
     */
    @Select("SELECT id, username, avatar_url, nickname FROM users WHERE deleted = 0 ORDER BY followers_count DESC LIMIT 10")
    List<User> selectPopularUsers();

    /**
     * 搜索公开用户
     */
    @Select("SELECT id, username, avatar_url, nickname, gender FROM users WHERE (username LIKE CONCAT('%', #{keyword}, '%') OR nickname LIKE CONCAT('%', #{keyword}, '%')) AND deleted = 0 LIMIT #{page.size} OFFSET #{page.offset}")
    List<User> searchPublicUsers(@Param("keyword") String keyword, @Param("page") Page<User> page);

    User selectByEmail(String email);

    Page<User> selectUsers(Page<User> userPage, String keyword);

    //SELECT status, COUNT(*) as total from users group by status order by total desc
    @Select("SELECT * FROM user_status_count")
    List<Map<String, Object>> selectStatusUserCount();

    //SELECT role, count(*) as total from users group by role order by total desc
    @Select("SELECT * FROM user_role_count")
    List<Map<String, Object>> selectRoleCount();

    //select gender, count(*) as total from users group by gender order by total desc;
    @Select("select * FROM user_gender_count")
    List<Map<String, Object>> selectGenderCount();

    /**
     * SELECT
     *   CASE
     *     WHEN TIMESTAMPDIFF(YEAR, birthday, CURDATE()) < 18 THEN 'Under 18'
     *     WHEN TIMESTAMPDIFF(YEAR, birthday, CURDATE()) BETWEEN 18 AND 30 THEN '18-30'
     *     WHEN TIMESTAMPDIFF(YEAR, birthday, CURDATE()) BETWEEN 31 AND 50 THEN '31-50'
     *     ELSE 'Over 50'
     *   END AS age_group,
     *   COUNT(*) AS total
     * FROM users
     * GROUP BY age_group;
     * @return
     */
    @Select("SELECT * FROM user_age_group")
    List<Map<String, Object>> selectAgeCount();

    @Select("{ CALL CheckUserUniqueness(#{username, mode=IN}, #{email, mode=IN}, #{phone, mode=IN}, #{result_message, mode=OUT}) }")
    void CheckUserUniqueness(UserCheckParams params);
}