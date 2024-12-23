package com.foodrecord.mapper;

import com.foodrecord.model.entity.user.UserInventory;

import java.util.List;

public interface UserInventoryMapper {
    List<UserInventory> selectAllByUserId(Long userId);

    List<UserInventory> selectExpiringSoon(Long userId);

    List<UserInventory> selectLowStock(Long userId);

    void insert(UserInventory inventory);

    void updateById(UserInventory inventory);

    void deleteById(Long id);
}
