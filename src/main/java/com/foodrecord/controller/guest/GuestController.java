package com.foodrecord.controller.guest;

import com.foodrecord.common.ApiResponse;
import com.foodrecord.model.entity.user.User;
import com.foodrecord.model.vo.UserVO;
import com.foodrecord.service.UserService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/public")
@Api(tags = "游客模块")
public class GuestController {

    @Resource
    private UserService userService;

    /**
     * 获取公开的用户信息
     * @param username
     * @return
     */
    @GetMapping("/user-profile/{username}")
    @ApiOperation("获取公开的用户信息")
    public ApiResponse<UserVO> getPublicUserProfile(@PathVariable String username) {
        User user = userService.getPublicUserByUsername(username);
        return ApiResponse.success(new UserVO().toUserVO(user));
    }

    /**
     * 查询公开的用户列表
     * @param keyword
     * @param page
     * @param size
     * @return
     */
    @GetMapping("/search-users")
    @ApiOperation("根据关键字查询公开用户列表")
    public ApiResponse<List<UserVO>> searchPublicUsers(@RequestParam String keyword,
                                                       @RequestParam int page,
                                                       @RequestParam int size) {
        List<UserVO> userVOList = new ArrayList<>();
        List<User> users = userService.searchPublicUsers(keyword, page, size);
        for (User user : users){
            userVOList.add(new UserVO().toUserVO(user));
        }
        return ApiResponse.success(userVOList);
    }

    /**
     * 获取用户数量
     * @return
     */
    @GetMapping("/user-count")
    @ApiOperation("获取用户总数")
    public ApiResponse<Long> getUserCount() {
        return ApiResponse.success(userService.getUserCount());
    }

    /**
     * 获取热门用户（根据某些规则，如关注数、发帖数等）
     * @return
     */
    @GetMapping("/popular-users")
    @ApiOperation("获取热门用户")
    public ApiResponse<List<UserVO>> getPopularUsers() {
        List<UserVO> userVOList = new ArrayList<>();
        List<User> users = userService.getPopularUsers();
        for (User user : users){
            userVOList.add(new UserVO().toUserVO(user));
        }
        return ApiResponse.success(userVOList);
    }

//    /**
//     * 游客访问统计
//     * @return
//     */
//    @PostMapping("/visitor-statistics")
//    @ApiOperation("统计游客访问记录")
//    public ApiResponse<Void> recordVisitor(@RequestParam String ipAddress,
//                                           @RequestParam(required = false) String referrer) {
//        userService.recordVisitor(ipAddress, referrer);
//        return ApiResponse.success(null);
//    }

//    /**
//     * 获取最近的访问统计
//     * @return
//     */
//    @GetMapping("/visitor-stats")
//    @ApiOperation("获取最近的游客访问统计")
//    public ApiResponse<Map<String, Object>> getVisitorStats() {
//        return ApiResponse.success(userService.getVisitorStats());
//    }

//    /**
//     * 获取系统公告
//     * @return
//     */
//    @GetMapping("/announcements")
//    @ApiOperation("获取系统公告")
//    public ApiResponse<List<Map<String, String>>> getAnnouncements() {
//        return ApiResponse.success(userService.getAnnouncements());
//    }

//    /**
//     * 游客注册体验账号（临时账号）
//     * @return
//     */
//    @PostMapping("/register-temporary")
//    @ApiOperation("游客注册临时账号（体验账号）")
//    public ApiResponse<Map<String, String>> registerTemporaryAccount() {
//        Map<String, String> temporaryAccount = userService.createTemporaryAccount();
//        return ApiResponse.success(temporaryAccount);
//    }
//
//    /**
//     * 获取用户最近的公开动态
//     * @param username
//     * @return
//     */
//    @GetMapping("/user-recent-activities/{username}")
//    @ApiOperation("获取用户最近的公开动态")
//    public ApiResponse<List<Map<String, Object>>> getRecentActivities(@PathVariable String username) {
//        return ApiResponse.success(userService.getRecentPublicActivities(username));
//    }
}
