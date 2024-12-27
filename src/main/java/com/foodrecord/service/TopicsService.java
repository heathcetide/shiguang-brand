package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.Topics;

import java.util.List;

/**
* @author Lenovo
* @description 针对表【topics】的数据库操作Service
* @createDate 2024-12-02 21:47:52
*/
public interface TopicsService extends IService<Topics> {
    List<Topics> searchByName(String name);
    List<Topics> getHotTopics();
    List<Topics> filterByPopularity(Integer minPopularity);

    boolean insert(Topics topic);

    Topics getTopicsByName(String name);

    Topics getByTopicId(Long id);
}
