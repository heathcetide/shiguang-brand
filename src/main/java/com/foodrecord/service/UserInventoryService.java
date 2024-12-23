package com.foodrecord.service;

import com.foodrecord.model.entity.user.UserInventory;

import java.util.List;

public interface UserInventoryService {

    List<UserInventory> getAllByUserId(Long userId);

    List<UserInventory> getExpiringSoon(Long userId);

    List<UserInventory> getLowStock(Long userId);

    void addInventory(UserInventory inventory);

    void updateInventory(UserInventory inventory);

    void deleteInventory(Long id);
}
