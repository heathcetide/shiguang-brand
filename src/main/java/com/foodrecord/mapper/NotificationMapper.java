package com.foodrecord.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.foodrecord.model.dto.NotificationQuery;
import com.foodrecord.model.entity.Notification;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface NotificationMapper extends BaseMapper<Notification> {
    /**
     * 保存通知记录
     * @param notification 通知对象
     * @return 插入的行数
     */
    int save(Notification notification);

    /**
     * 查找用户的未读通知
     * @param userId 用户ID
     * @return 未读通知列表
     */
    List<Notification> findUnreadByUserId(@Param("userId") Long userId);

    /**
     * 标记单个通知为已读
     * @param notificationId 通知ID
     * @return 更新的行数
     */
    int markAsRead(@Param("notificationId") Long notificationId);

    /**
     * 标记用户的所有通知为已读
     * @param userId 用户ID
     * @return 更新的行数
     */
    int markAllAsRead(@Param("userId") Long userId);


    /**
     * 分页查询通知
     */
    List<Notification> queryNotifications(@Param("query") NotificationQuery query);
}
