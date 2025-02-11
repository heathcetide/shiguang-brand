package com.foodrecord.service;

import com.foodrecord.model.entity.Levels;

import java.util.List;

public interface LevelsService {

    void addLevel(Levels level);
    Levels getLevelById(Long id);
    List<Levels> getAllLevels();
    void updateLevel(Levels level);
    void deleteLevel(Long id);
}
