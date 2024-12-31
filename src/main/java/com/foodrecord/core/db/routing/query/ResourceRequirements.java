package com.foodrecord.core.db.routing.query;

public class ResourceRequirements {
    private final double cpuRequirement;
    private final double memoryRequirement;
    private final double ioRequirement;

    public ResourceRequirements(double cpuRequirement, double memoryRequirement, double ioRequirement) {
        this.cpuRequirement = cpuRequirement;
        this.memoryRequirement = memoryRequirement;
        this.ioRequirement = ioRequirement;
    }

    public double getCpuRequirement() {
        return cpuRequirement;
    }

    public double getMemoryRequirement() {
        return memoryRequirement;
    }

    public double getIoRequirement() {
        return ioRequirement;
    }
}
