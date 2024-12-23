package com.foodrecord.service;

import java.util.Map;

public interface UserPreferenceService {

    void setUserPreference(Long userId, String channel, String userName);

    Map<String, String> getUserPreference(Long userId);

    String getUserPreferredChannel(Long userId);

    String getUserName(Long userId);
}
