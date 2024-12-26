//package com.foodrecord.interceptor;
//import org.springframework.http.server.ServerHttpRequest;
//import org.springframework.http.server.ServerHttpResponse;
//import org.springframework.web.socket.WebSocketHandler;
//import org.springframework.web.socket.server.HandshakeInterceptor;
//
//import javax.servlet.http.HttpServletRequest;
//import org.springframework.http.server.ServletServerHttpRequest;
//
//import java.util.Map;
//
//public class WebSocketHandshakeInterceptor implements HandshakeInterceptor {
//
//    @Override
//    public boolean beforeHandshake(
//            ServerHttpRequest serverHttpRequest,
//            ServerHttpResponse serverHttpResponse,
//            WebSocketHandler webSocketHandler,
//            Map<String, Object> attributes) throws Exception {
//
//        // 将 ServerHttpRequest 转换为 ServletServerHttpRequest
//        if (serverHttpRequest instanceof ServletServerHttpRequest) {
//            ServletServerHttpRequest servletRequest = (ServletServerHttpRequest) serverHttpRequest;
//            HttpServletRequest request = servletRequest.getServletRequest();
//
//            // 获取 userId 参数
//            String userId = request.getParameter("userId");
//            if (userId != null) {
//                attributes.put("userId", userId); // 存入 attributes
//                return true; // 握手成功
//            }
//        }
//
//        System.out.println("Handshake failed: userId is null");
//        return false; // 握手失败
//    }
//
//    @Override
//    public void afterHandshake(
//            ServerHttpRequest serverHttpRequest,
//            ServerHttpResponse serverHttpResponse,
//            WebSocketHandler webSocketHandler,
//            Exception e) {
//        // 握手完成后的逻辑
//    }
//}
