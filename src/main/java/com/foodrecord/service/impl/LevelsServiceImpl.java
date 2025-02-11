package com.foodrecord.service.impl;

import com.foodrecord.mapper.LevelsMapper;
import com.foodrecord.model.entity.Levels;
import com.foodrecord.service.LevelsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class LevelsServiceImpl implements LevelsService {
    @Autowired
    private LevelsMapper levelsMapper;

    @Override
    public void addLevel(Levels level) {
        levelsMapper.insert(level);
    }

    @Override
    public Levels getLevelById(Long id) {
        return levelsMapper.selectById(id);
    }

    @Override
    public List<Levels> getAllLevels() {
        return levelsMapper.selectAll();
    }

    @Override
    public void updateLevel(Levels level) {
        levelsMapper.update(level);
    }

    @Override
    public void deleteLevel(Long id) {
        levelsMapper.delete(id);
    }
}
