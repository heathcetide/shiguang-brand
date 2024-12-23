package com.foodrecord.service.impl;

import com.foodrecord.mapper.UserInventoryMapper;
import com.foodrecord.model.entity.user.UserInventory;
import com.foodrecord.service.UserInventoryService;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.List;

@Service
public class UserInventoryServiceImpl implements UserInventoryService {

    @Resource
    private UserInventoryMapper userInventoryMapper;

    @Override
    public List<UserInventory> getAllByUserId(Long userId) {
        return userInventoryMapper.selectAllByUserId(userId);
    }

    @Override
    public List<UserInventory> getExpiringSoon(Long userId) {
        return userInventoryMapper.selectExpiringSoon(userId);
    }

    @Override
    public List<UserInventory> getLowStock(Long userId) {
        return userInventoryMapper.selectLowStock(userId);
    }

    @Override
    public void addInventory(UserInventory inventory) {
        userInventoryMapper.insert(inventory);
    }

    @Override
    public void updateInventory(UserInventory inventory) {
        userInventoryMapper.updateById(inventory);
    }

    @Override
    public void deleteInventory(Long id) {
        userInventoryMapper.deleteById(id);
    }
}
