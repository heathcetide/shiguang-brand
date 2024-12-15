package com.foodrecord.common.security.desensitize;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.BeanProperty;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.ser.ContextualSerializer;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * 脱敏序列化器
 * 用于在JSON序列化时自动进行数据脱敏
 * 
 * @author yourname
 * @since 1.0.0
 */
@Component
public class DesensitizeSerializer extends JsonSerializer<String> implements ContextualSerializer {
    private final DesensitizeProcessor desensitizeProcessor;
    private Desensitize desensitize;
    private String fieldName;
    
    public DesensitizeSerializer(DesensitizeProcessor desensitizeProcessor) {
        this.desensitizeProcessor = null;
    }
    
    @Override
    public void serialize(String value, JsonGenerator gen, SerializerProvider provider) throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }
        
        String result = desensitizeProcessor.process(value, fieldName, desensitize.scene());
        gen.writeString(result);
    }
    
    @Override
    public JsonSerializer<?> createContextual(SerializerProvider provider, BeanProperty property) throws JsonMappingException {
        if (property == null || !String.class.isAssignableFrom(property.getType().getRawClass())) {
            return provider.findValueSerializer(property.getType(), property);
        }
        
        Desensitize desensitize = property.getAnnotation(Desensitize.class);
        if (desensitize == null) {
            return provider.findValueSerializer(property.getType(), property);
        }
        
        DesensitizeSerializer serializer = new DesensitizeSerializer(desensitizeProcessor);
        serializer.desensitize = desensitize;
        serializer.fieldName = property.getName();
        return serializer;
    }
} 