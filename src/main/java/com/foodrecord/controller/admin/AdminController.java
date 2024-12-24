package com.foodrecord.controller.admin;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.foodrecord.common.ApiResponse;
import com.foodrecord.common.auth.RequireRole;
import com.foodrecord.common.utils.CsvExportUtil;
import com.foodrecord.common.utils.ExcelExportUtil;
import com.foodrecord.common.utils.JsonExportUtil;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.service.UserService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import io.swagger.annotations.ApiParam;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/user")
@Api(tags = "管理用户模块")
public class AdminController {

    @Resource
    private UserService userService;

    /**
     * 分页查询用户
     *
     * @param page    页码，从1开始，默认值为1
     * @param size    每页记录数，默认值为10
     * @param keyword 关键字，可选，用于模糊搜索用户信息
     * @return 分页用户数据
     */
    @GetMapping("/get/page")
    @ApiOperation(value = "分页获取用户", notes = "分页获取用户列表，支持通过关键字模糊搜索")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Page<User>> getAllUsers(
            @ApiParam(value = "页码，从1开始", example = "1")
            @RequestParam(value = "page", defaultValue = "1") int page,

            @ApiParam(value = "每页记录数", example = "10")
            @RequestParam(value = "size", defaultValue = "10") int size,

            @ApiParam(value = "搜索关键字，可选", example = "John")
            @RequestParam(value = "keyword", required = false) String keyword) {
        Page<User> userPage = userService.getUsers(new Page<>(page, size), keyword);
        return ApiResponse.success(userPage);
    }


    /**
     * 管理员创建用户
     *
     * @param user 用户实体对象
     * @return 创建是否成功
     */
    @PostMapping("/create")
    @ApiOperation(value = "管理员创建用户", notes = "管理员新增用户，传入用户相关信息")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> createUser(
            @ApiParam(value = "用户实体对象", required = true)
            @RequestBody User user) {
        boolean success = userService.createUser(user);
        return success ? ApiResponse.success(true) : ApiResponse.error(300, "创建失败");
    }

    /**
     * 管理员更新用户信息
     *
     * @param id   用户ID
     * @param user 用户实体对象
     * @return 更新是否成功
     */
    @PutMapping("/update/{id}")
    @ApiOperation(value = "管理员更新用户信息", notes = "通过用户ID更新用户信息")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> updateUserByAdmin(
            @ApiParam(value = "用户ID", required = true, example = "123")
            @PathVariable Long id,

            @ApiParam(value = "用户实体对象", required = true)
            @RequestBody User user) {
        boolean success = userService.updateUserByAdmin(id, user);
        return success ? ApiResponse.success(true) : ApiResponse.error(300, "更新失败");
    }

    /**
     * 管理员删除用户
     *
     * @param id 用户ID
     * @return 删除是否成功
     */
    @DeleteMapping("/delete/{id}")
    @ApiOperation(value = "管理员删除用户", notes = "通过用户ID删除用户")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> deleteUserByAdmin(
            @ApiParam(value = "用户ID", required = true, example = "123")
            @PathVariable Long id) {
        boolean success = userService.deleteUserByAdmin(id);
        return success ? ApiResponse.success(true) : ApiResponse.error(300, "删除失败");
    }


    /**
     * 根据用户ID查询用户详情
     *
     * @param id 用户ID
     * @return 用户详情
     */
    @GetMapping("/detail/{id}")
    @ApiOperation(value = "根据用户ID查询用户详情", notes = "通过用户ID获取用户的详细信息")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<User> getUserDetail(
            @ApiParam(value = "用户ID", required = true, example = "123")
            @PathVariable Long id) {
        User user = userService.getById(id);
        return user != null ? ApiResponse.success(user) : ApiResponse.error(404, "用户不存在");
    }

    /**
     * 修改用户状态
     *
     * @param id     用户ID
     * @param status 新的状态值（如1表示激活，0表示禁用）
     * @return 修改是否成功
     */
    @PutMapping("/status/{id}")
    @ApiOperation(value = "修改用户状态", notes = "通过用户ID修改用户的激活或禁用状态")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> updateUserStatus(
            @ApiParam(value = "用户ID", required = true, example = "123")
            @PathVariable Long id,

            @ApiParam(value = "新的状态值", required = true, example = "1")
            @RequestParam int status) {
        User user = userService.getById(id);
        if (user != null) {
            user.setStatus(status);
            boolean success = userService.updateById(user);
            return success ? ApiResponse.success(true) : ApiResponse.error(300, "修改失败");
        }
        return ApiResponse.error(404, "用户不存在");
    }

    /**
     * 重置用户密码
     *
     * @param id          用户ID
     * @param newPassword 新密码
     * @return 是否重置成功
     */
    @PutMapping("/reset-password/{id}")
    @ApiOperation(value = "重置用户密码", notes = "通过用户ID重置用户密码，注意密码应加密存储")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> resetUserPassword(
            @ApiParam(value = "用户ID", required = true, example = "123")
            @PathVariable Long id,

            @ApiParam(value = "新密码", required = true)
            @RequestParam String newPassword) {
        User user = userService.getById(id);
        if (user != null) {
            user.setPassword(newPassword); // 应对密码进行加密处理
            boolean success = userService.updateById(user);
            return success ? ApiResponse.success(true) : ApiResponse.error(300, "重置失败");
        }
        return ApiResponse.error(404, "用户不存在");
    }

    /**
     * 批量删除用户
     *
     * @param userIds 用户ID列表
     * @return 删除是否成功
     */
    @DeleteMapping("/delete-batch")
    @ApiOperation(value = "批量删除用户", notes = "根据用户ID列表批量删除用户")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> deleteUsersBatch(
            @ApiParam(value = "用户ID列表", required = true, example = "[123, 124, 125]")
            @RequestBody List<Long> userIds) {
        boolean success = userService.removeByIds(userIds);
        return success ? ApiResponse.success(true) : ApiResponse.error(300, "批量删除失败");
    }

    /**
     * 批量操作用户状态
     *
     * @param userIds 用户ids
     * @param status  状态
     * @return 是否操作成功
     */
    @PutMapping("/status-batch")
    @ApiOperation("批量操作用户状态")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> updateUserStatusBatch(@RequestBody List<Long> userIds, @RequestParam int status) {
        List<User> users = userService.listByIds(userIds);
        for (User user : users) {
            user.setStatus(status);
        }
        boolean b = userService.updateBatchById(users);
        if (b) {
            return ApiResponse.success(true);
        }
        return ApiResponse.error(300, "批量操作用户状态失败");
    }

    /**
     * 将用户数据导出为  CSV 格式
     *
     * @param response HttpServletResponse
     */
    @GetMapping("/export/csv")
    @ApiOperation("将用户数据导出为  CSV 格式")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public void exportUsersByCSV(HttpServletResponse response) {
        List<User> users = userService.list();
        // 调用工具类将用户列表导出为CSV
        CsvExportUtil.exportToCsv(response, users);
    }

    /**
     * 将用户数据导出为 Excel 格式
     *
     * @param response HttpServletResponse
     */
    @GetMapping("/export/excel")
    @ApiOperation("将用户数据导出为 Excel 格式")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public void exportUserByExcel(HttpServletResponse response) {
        List<User> users = userService.list();
        // 调用工具类将用户列表导出为CSV
        ExcelExportUtil.exportToExcel(response, users);
    }

    /**
     * 导出用户数据为 JSON 格式
     *
     * @param response HTTP 响应对象
     */
    @GetMapping("/export/json")
    @ApiOperation(value = "将用户数据导出为 JSON 格式", notes = "导出用户数据为 JSON 格式文件")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public void exportUserByJSON(HttpServletResponse response) {
        List<User> users = userService.list();
        JsonExportUtil.exportToJson(response, users);
    }

    /**
     * 分配角色或调整权限
     *
     * @param id   用户id
     * @param role 角色
     * @return 是否成功
     */
    @PutMapping("/assign-role/{id}")
    @ApiOperation("分配角色或调整权限")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> assignRoleToUser(@PathVariable Long id, @RequestParam String role) {
        User user = userService.getById(id);
        if (user != null) {
            user.setRole(role);
            boolean b = userService.updateById(user);
            if (b) {
                return ApiResponse.success(true);
            }
            return ApiResponse.error(300, "调整权限失败");
        }
        return ApiResponse.error(300, "调整权限失败");
    }

    /**
     * 统计用户数据
     *
     * @return 用户统计信息（总用户数、活跃用户数等）
     */
    @GetMapping("/statistics")
    @ApiOperation(value = "统计用户数据", notes = "统计用户的总数、角色分布和活跃用户数量")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Map<String, Object>> getUserStatistics() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalUsers", userService.count());
        stats.put("activeUsers", userService.lambdaQuery().eq(User::getStatus, 1).count());
        stats.put("admins", userService.lambdaQuery().eq(User::getRole, "ADMIN").count());
        return ApiResponse.success(stats);
    }

    /**
     * 支持 JSON、CSV 和 Excel 文件导入用户
     *
     * @param file 上传的文件
     * @return 是否成功
     */
    @PostMapping("/import")
    @ApiOperation("支持 JSON、CSV 和 Excel 文件导入用户")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Boolean> importUsers(@RequestParam("file") MultipartFile file) {
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
            boolean b = userService.saveBatch(users);
            if (b) {
                return ApiResponse.success(true);
            }
            return ApiResponse.error(300, "操作失败");
        } catch (Exception e) {
            throw new RuntimeException("导入用户失败: " + e.getMessage(), e);
        }
    }

    /**
     * 用户行为分析
     *
     * @param startDate 开始日期
     * @param endDate   结束日期
     * @return 用户行为分析数据
     */
    @GetMapping("/analytics")
    @ApiOperation(value = "用户行为分析", notes = "统计指定时间段内的新增用户和活跃用户")
    @RequireRole({"ADMIN", "SUPER_ADMIN"})
    public ApiResponse<Map<String, Object>> getUserAnalytics(
            @ApiParam(value = "开始日期", example = "2023-01-01")
            @RequestParam(required = false) String startDate,

            @ApiParam(value = "结束日期", example = "2023-12-31")
            @RequestParam(required = false) String endDate) {
        Map<String, Object> analytics = new HashMap<>();
        try {
            analytics.put("newUsers", userService.countNewUsers(startDate, endDate));
            analytics.put("activeUsers", userService.countActiveUsers(startDate, endDate));
            List<Map<String, Object>> maps = userService.countUsersByStatus();
            analytics.put("status", maps);
            List<Map<String, Object>> maps1 = userService.countUsersByRole();
            analytics.put("role", maps1);
            List<Map<String, Object>> maps2 = userService.countUsersByGender();
            analytics.put("gender", maps2);
            List<Map<String, Object>> maps3 = userService.countUsersByAge();
            analytics.put("age", maps3);
            return ApiResponse.success(analytics);
        } catch (Exception e) {
            e.printStackTrace();
        }
        return null;
    }
}
