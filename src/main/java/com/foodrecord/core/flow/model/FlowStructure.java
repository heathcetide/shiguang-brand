package com.foodrecord.core.flow.model;

import java.util.*;

public class FlowStructure {
    private String flowId;
    private List<Node> nodes;
    private Map<String, List<String>> dependencies;
    private Map<String, List<String>> reverseDependencies;

    public FlowStructure() {
        this.nodes = new ArrayList<>();
        this.dependencies = new HashMap<>();
        this.reverseDependencies = new HashMap<>();
    }

    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public List<Node> getNodes() {
        return nodes;
    }

    public void setNodes(List<Node> nodes) {
        this.nodes = nodes;
    }

    public Map<String, List<String>> getDependencies() {
        return dependencies;
    }

    public void setDependencies(Map<String, List<String>> dependencies) {
        this.dependencies = dependencies;
    }

    public Map<String, List<String>> getReverseDependencies() {
        return reverseDependencies;
    }

    public void setReverseDependencies(Map<String, List<String>> reverseDependencies) {
        this.reverseDependencies = reverseDependencies;
    }

    public void addNode(Node node) {
        nodes.add(node);
        dependencies.putIfAbsent(node.getId(), new ArrayList<>());
        reverseDependencies.putIfAbsent(node.getId(), new ArrayList<>());
    }

    public void addDependency(String fromNodeId, String toNodeId) {
        dependencies.computeIfAbsent(fromNodeId, k -> new ArrayList<>()).add(toNodeId);
        reverseDependencies.computeIfAbsent(toNodeId, k -> new ArrayList<>()).add(fromNodeId);
    }

    public static class Node {
        private String id;
        private String type;
        private Map<String, Object> properties;

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public Map<String, Object> getProperties() {
            return properties;
        }

        public void setProperties(Map<String, Object> properties) {
            this.properties = properties;
        }
    }
} 