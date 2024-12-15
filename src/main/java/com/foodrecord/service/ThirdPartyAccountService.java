package com.foodrecord.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.foodrecord.model.entity.ThirdPartyAccount;

public interface ThirdPartyAccountService extends IService<ThirdPartyAccount> {

    ThirdPartyAccount getByUserIdAndPlatform(Long userId, String platform);

    boolean removeByUserIdAndPlatform(Long userId, String platform);
}
