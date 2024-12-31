package com.foodrecord.core.module;

public abstract class AbstractModule implements ModuleLifecycle {
    protected ModuleStatus status = ModuleStatus.CREATED;
    
    @Override
    public void onInit() {
        status = ModuleStatus.INITIALIZED;
    }
    
    @Override
    public void onStart() {
        status = ModuleStatus.RUNNING;
    }
    
    @Override
    public void onStop() {
        status = ModuleStatus.STOPPED;
    }
    
    @Override
    public void onDestroy() {
        status = ModuleStatus.DESTROYED;
    }
    
    public ModuleStatus getStatus() {
        return status;
    }
} 