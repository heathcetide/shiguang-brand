package com.foodrecord.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.utils.CsvExportUtil;
import com.foodrecord.common.utils.ExcelExportUtil;
import com.foodrecord.common.utils.JsonExportUtil;
import com.foodrecord.model.entity.User;
import com.foodrecord.service.UserService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.servlet.http.HttpServletResponse;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    @Autowired
    private UserService userService;

    /**
     * 分页查询用户
     * @param page
     * @param size
     * @return
     */
    @GetMapping("/all")
    public Page<User> getAllUsers(
            @RequestParam(defaultValue = "1") int page,  // 当前页码，默认第一页
            @RequestParam(defaultValue = "10") int size // 每页显示数量，默认10条
    ) {
        return userService.page(new Page<>(page, size));
    }

    /**
     * 管理员创建用户
     * @param user
     * @return
     */
    @PostMapping("/create")
    public boolean createUser(@RequestBody User user) {
        return userService.createUser(user);
    }

    /**
     * 管理员更新用户信息
     * @param id
     * @param user
     * @return
     */
    @PutMapping("/update/{id}")
    public boolean updateUserByAdmin(@PathVariable Long id, @RequestBody User user) {
        return userService.updateUserByAdmin(id, user);
    }

    /**
     *  管理员删除用户
     * @param id
     * @return
     */
    @DeleteMapping("/delete/{id}")
    public boolean deleteUserByAdmin(@PathVariable Long id) {
        return userService.deleteUserByAdmin(id);
    }

    /**
     * 根据用户ID查询用户详情
     * @param id
     * @return
     */
    @GetMapping("/detail/{id}")
    public User getUserDetail(@PathVariable Long id) {
        return userService.getById(id);
    }

    /**
     * 根据关键词搜索用户
     * @param keyword
     * @return
     */
    @GetMapping("/search")
    public List<User> searchUsers(@RequestParam String keyword) {
        return userService.lambdaQuery()
                .like(User::getUsername, keyword)
                .or()
                .like(User::getEmail, keyword)
                .or()
                .like(User::getPhone, keyword)
                .list();
    }

    /**
     * 修改用户状态
     * @param id
     * @param status
     * @return
     */
    @PutMapping("/status/{id}")
    public boolean updateUserStatus(@PathVariable Long id, @RequestParam int status) {
        User user = userService.getById(id);
        if (user != null) {
            user.setStatus(status);
            return userService.updateById(user);
        }
        return false;
    }

    /**
     * 重置用户密码
     * @param id
     * @param newPassword
     * @return
     */
    @PutMapping("/reset-password/{id}")
    public boolean resetUserPassword(@PathVariable Long id, @RequestParam String newPassword) {
        User user = userService.getById(id);
        if (user != null) {
            user.setPassword(newPassword);  // 注意：应该对密码进行加密
            return userService.updateById(user);
        }
        return false;
    }

    /**
     * 批量删除用户
     * @param userIds
     * @return
     */
    @DeleteMapping("/delete-batch")
    public boolean deleteUsersBatch(@RequestBody List<Long> userIds) {
        return userService.removeByIds(userIds);
    }

    /**
     * 批量操作用户状态
     * @param userIds
     * @param status
     * @return
     */
    @PutMapping("/status-batch")
    public boolean updateUserStatusBatch(@RequestBody List<Long> userIds, @RequestParam int status) {
        List<User> users = userService.listByIds(userIds);
        for (User user : users) {
            user.setStatus(status);
        }
        return userService.updateBatchById(users);
    }

    /**
     * 将用户数据导出为  CSV 格式
     * @param response
     */
    @GetMapping("/export/csv")
    public void exportUsersByCSV(HttpServletResponse response) {
        List<User> users = userService.list();
        // 调用工具类将用户列表导出为CSV
        CsvExportUtil.exportToCsv(response, users);
    }

    /**
     * 将用户数据导出为 Excel 格式
     * @param response
     */
    @GetMapping("/export/excel")
    public void exportUserByExcel(HttpServletResponse response) {
        List<User> users = userService.list();
        // 调用工具类将用户列表导出为CSV
        ExcelExportUtil.exportToExcel(response, users);
    }

    /**
     * 将用户数据导出为 JSON 格式
     * @param response
     */
    @GetMapping("/export/json")
    public void exportUserByJSON(HttpServletResponse response) {
        List<User> users = userService.list();
        // 调用工具类将用户列表导出为CSV
        JsonExportUtil.exportToJson(response, users);
    }
    /**
     * 分配角色或调整权限
     * @param id
     * @param role
     * @return
     */
    @PutMapping("/assign-role/{id}")
    public boolean assignRoleToUser(@PathVariable Long id, @RequestParam String role) {
        User user = userService.getById(id);
        if (user != null) {
            user.setRole(role);
            return userService.updateById(user);
        }
        return false;
    }

    /**
     * 统计数据，例如用户总数、角色分布
     * @return
     */
    @GetMapping("/statistics")
    public Map<String, Object> getUserStatistics() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalUsers", userService.count());
        stats.put("activeUsers", userService.lambdaQuery().eq(User::getStatus, 1).count());
        stats.put("admins", userService.lambdaQuery().eq(User::getRole, "ADMIN").count());
        return stats;
    }

    /**
     * 支持 JSON、CSV 和 Excel 文件导入用户
     * @param file 上传的文件
     * @return 是否成功
     */
    @PostMapping("/import")
    public boolean importUsers(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            throw new IllegalArgumentException("上传文件不能为空");
        }

        String fileName = file.getOriginalFilename();
        if (fileName == null) {
            throw new IllegalArgumentException("文件名不能为空");
        }

        try {
            List<User> users;
            if (fileName.endsWith(".json")) {
                // JSON 文件处理
                users = JsonExportUtil.readUsersFromJson(file);
            } else if (fileName.endsWith(".csv")) {
                // CSV 文件处理
                users = CsvExportUtil.readUsersFromCsv(file);
            } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
                // Excel 文件处理
                users = ExcelExportUtil.readUsersFromExcel(file);
            } else {
                throw new IllegalArgumentException("不支持的文件格式");
            }
            return userService.saveBatch(users);
        } catch (Exception e) {
            throw new RuntimeException("导入用户失败: " + e.getMessage(), e);
        }
    }

    /**
     * 行为分析
     * @param startDate
     * @param endDate
     * @return
     */
    @GetMapping("/analytics")
    public Map<String, Object> getUserAnalytics(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate
    ) {
        Map<String, Object> analytics = new HashMap<>();
        analytics.put("newUsers", userService.countNewUsers(startDate, endDate));
        analytics.put("activeUsers", userService.countActiveUsers(startDate, endDate));
        return analytics;
    }

    /**
     * 解封
     * @param id
     * @return
     */
    @PutMapping("/unlock/{id}")
    public boolean unlockUserAccount(@PathVariable Long id) {
        User user = userService.getById(id);
        if (user != null && user.getStatus() == 3) { // 3 表示锁定状态
            user.setStatus(1); // 设置为正常状态
            return userService.updateById(user);
        }
        return false;
    }

}
