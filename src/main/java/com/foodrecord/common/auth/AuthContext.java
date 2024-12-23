package com.foodrecord.common.auth;

import com.foodrecord.model.entity.user.User;

public class AuthContext {

    private static final ThreadLocal<User> currentUser = new ThreadLocal<>();
    private static final ThreadLocal<String> currentToken = new ThreadLocal<>();

    public static void setCurrentUser(User user) {
        currentUser.set(user);
    }

    public static User getCurrentUser() {
        return currentUser.get();
    }

    public static void setCurrentToken(String token) {
        currentToken.set(token);
    }

    public static String getCurrentToken() {
        return currentToken.get();
    }

    public static void clear() {
        currentUser.remove();
        currentToken.remove();
    }
} 