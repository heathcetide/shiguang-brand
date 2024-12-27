package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.TopicsMapper;
import com.foodrecord.model.entity.Topics;
import com.foodrecord.service.TopicsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class TopicsServiceImpl extends ServiceImpl<TopicsMapper, Topics>
        implements TopicsService {
    @Autowired
    private TopicsMapper topicsMapper;

    @Override
    public List<Topics> searchByName(String name) {
        return topicsMapper.selectByName('%'+name+'%');
    }

    @Override
    public List<Topics> getHotTopics() {
        return lambdaQuery().orderByDesc(Topics::getPopularity).list();
    }

    @Override
    public List<Topics> filterByPopularity(Integer minPopularity) {
        return lambdaQuery().ge(Topics::getPopularity, minPopularity).list();
    }

    @Override
    public boolean insert(Topics topic) {
        return topicsMapper.save(topic) == 1;
    }

    @Override
    public Topics getTopicsByName(String name) {
        return topicsMapper.selectTopicsByName(name);
    }

    @Override
    public Topics getByTopicId(Long id) {
        return topicsMapper.selectTopicById(id);
    }
}
