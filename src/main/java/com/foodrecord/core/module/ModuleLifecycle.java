package com.foodrecord.core.module;

public interface ModuleLifecycle {
    void onInit();
    void onStart();
    void onStop();
    void onDestroy();
} 