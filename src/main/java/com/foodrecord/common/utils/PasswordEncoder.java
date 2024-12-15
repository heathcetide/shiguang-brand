package com.foodrecord.common.utils;

import org.mindrot.jbcrypt.BCrypt;
import org.springframework.stereotype.Component;

@Component
public class PasswordEncoder {
    
    public static String encode(String password) {
        return BCrypt.hashpw(password, BCrypt.gensalt());
    }
    
    public static boolean matches(String password, String hashedPassword) {
        return BCrypt.checkpw(password, hashedPassword);
    }
} 