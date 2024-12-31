package com.foodrecord.core.flow.visualization;

import com.foodrecord.core.flow.model.FlowNode;
import org.springframework.stereotype.Component;
import java.util.List;
import java.util.Map;

@Component
public class FlowVisualizer {
    public String generateMermaidDiagram(List<FlowNode> nodes) {
        StringBuilder diagram = new StringBuilder("graph TD;\n");
        
        for (FlowNode node : nodes) {
            String nodeStyle = getNodeStyle(node.getType());
            diagram.append(String.format("    %s[%s]%s\n", 
                node.getId(), node.getName(), nodeStyle));
                
            for (String nextId : node.getNextNodes()) {
                diagram.append(String.format("    %s --> %s\n", 
                    node.getId(), nextId));
            }
        }
        
        return diagram.toString();
    }
    
    private String getNodeStyle(String nodeType) {
        switch (nodeType) {
            case "start": return ":::start";
            case "end": return ":::end";
            case "task": return ":::task";
            default: return "";
        }
    }
} 