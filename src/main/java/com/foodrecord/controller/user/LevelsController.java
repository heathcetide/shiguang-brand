package com.foodrecord.controller.user;

import com.foodrecord.model.entity.Levels;
import com.foodrecord.service.LevelsService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/levels")
public class LevelsController {
    @Autowired
    private LevelsService levelsService;

    @PostMapping
    public void addLevel(@RequestBody Levels level) {
        levelsService.addLevel(level);
    }

    @GetMapping("/{id}")
    public Levels getLevelById(@PathVariable Long id) {
        return levelsService.getLevelById(id);
    }

    @GetMapping
    public List<Levels> getAllLevels() {
        return levelsService.getAllLevels();
    }

    @PutMapping("/{id}")
    public void updateLevel(@PathVariable Long id, @RequestBody Levels level) {
        level.setId(id);
        levelsService.updateLevel(level);
    }

    @DeleteMapping("/{id}")
    public void deleteLevel(@PathVariable Long id) {
        levelsService.deleteLevel(id);
    }
}
