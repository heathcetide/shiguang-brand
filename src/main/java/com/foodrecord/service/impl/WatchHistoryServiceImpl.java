package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;

import com.foodrecord.mapper.WatchHistoryMapper;
import com.foodrecord.model.entity.video.WatchHistory;
import com.foodrecord.service.WatchHistoryService;
import org.springframework.stereotype.Service;

/**
* @author Lenovo
* @description 针对表【watch_history(用户观看历史表)】的数据库操作Service实现
* @createDate 2024-12-05 19:08:09
*/
@Service
public class WatchHistoryServiceImpl extends ServiceImpl<WatchHistoryMapper, WatchHistory>
    implements WatchHistoryService {

}




