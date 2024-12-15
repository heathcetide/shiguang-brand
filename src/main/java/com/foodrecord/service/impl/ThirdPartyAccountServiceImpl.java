package com.foodrecord.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.foodrecord.mapper.ThirdPartyAccountMapper;
import com.foodrecord.model.entity.ThirdPartyAccount;
import com.foodrecord.service.ThirdPartyAccountService;
import org.springframework.stereotype.Service;

@Service
public class ThirdPartyAccountServiceImpl extends ServiceImpl<ThirdPartyAccountMapper, ThirdPartyAccount>
        implements ThirdPartyAccountService {

    @Override
    public ThirdPartyAccount getByUserIdAndPlatform(Long userId, String platform) {
        return lambdaQuery()
                .eq(ThirdPartyAccount::getUserId, userId)
                .eq(ThirdPartyAccount::getPlatform, platform)
                .one();
    }

    @Override
    public boolean removeByUserIdAndPlatform(Long userId, String platform) {
        return lambdaUpdate()
                .eq(ThirdPartyAccount::getUserId, userId)
                .eq(ThirdPartyAccount::getPlatform, platform)
                .remove();
    }
}
