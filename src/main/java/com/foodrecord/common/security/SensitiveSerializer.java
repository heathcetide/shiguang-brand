package com.foodrecord.common.security;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.BeanProperty;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.ser.ContextualSerializer;
import java.io.IOException;
import java.util.regex.Pattern;

/**
 * 敏感数据序列化器
 * 用于在JSON序列化时自动进行数据脱敏
 * 
 * @author yourname
 * @since 1.0.0
 */
public class SensitiveSerializer extends JsonSerializer<String> implements ContextualSerializer {
    private SensitiveType type;
    private String pattern;
    private String replacement;

    @Override
    public void serialize(String value, JsonGenerator gen, SerializerProvider provider) throws IOException {
        if (value == null) {
            gen.writeNull();
            return;
        }

        if (type == SensitiveType.CUSTOM && pattern != null) {
            gen.writeString(Pattern.compile(pattern).matcher(value).replaceAll(replacement));
        } else {
            gen.writeString(type.desensitize(value));
        }
    }

    @Override
    public JsonSerializer<?> createContextual(SerializerProvider prov, BeanProperty property) throws JsonMappingException {
        Sensitive annotation = property.getAnnotation(Sensitive.class);
        if (annotation != null) {
            this.type = annotation.type();
            this.pattern = annotation.pattern();
            this.replacement = annotation.replacement();
            return this;
        }
        return prov.findValueSerializer(property.getType(), property);
    }
} 