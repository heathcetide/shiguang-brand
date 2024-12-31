package com.foodrecord.core.flow.context;

import java.util.HashMap;
import java.util.Map;
import java.util.Stack;


public class FlowContext {
    private String flowId;
    private Map<String, Object> variables = new HashMap<>();
    private Stack<String> executionPath = new Stack<>();
    private boolean terminated = false;
    
    public void setVariable(String key, Object value) {
        variables.put(key, value);
    }
    
    public Object getVariable(String key) {
        return variables.get(key);
    }
    
    public void pushNode(String nodeId) {
        executionPath.push(nodeId);
    }
    
    public String popNode() {
        return executionPath.pop();
    }
    
    public void terminate() {
        this.terminated = true;
    }

    public String getFlowId() {
        return flowId;
    }

    public void setFlowId(String flowId) {
        this.flowId = flowId;
    }

    public Map<String, Object> getVariables() {
        return variables;
    }

    public void setVariables(Map<String, Object> variables) {
        this.variables = variables;
    }

    public Stack<String> getExecutionPath() {
        return executionPath;
    }

    public void setExecutionPath(Stack<String> executionPath) {
        this.executionPath = executionPath;
    }

    public boolean isTerminated() {
        return terminated;
    }

    public void setTerminated(boolean terminated) {
        this.terminated = terminated;
    }
}