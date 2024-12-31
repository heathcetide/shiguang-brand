package com.foodrecord.core.flow.validator;

import com.foodrecord.core.flow.model.FlowNode;
import java.util.List;
import java.util.Optional;

public interface FlowValidator {
    Optional<String> validate(List<FlowNode> nodes);
} 