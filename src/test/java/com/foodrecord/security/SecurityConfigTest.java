package com.foodrecord.security;//package com.foodrecord.security;
//
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
//import org.springframework.boot.test.context.SpringBootTest;
//import org.springframework.security.test.context.support.WithMockUser;
//import org.springframework.test.web.servlet.MockMvc;
//
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@SpringBootTest
//@AutoConfigureMockMvc
//class SecurityConfigTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Test
//    void shouldAllowPublicEndpoints() throws Exception {
//        mockMvc.perform(post("/api/auth/login"))
//                .andExpect(status().isOk());
//
//        mockMvc.perform(post("/api/auth/register"))
//                .andExpect(status().isOk());
//    }
//
//    @Test
//    void shouldBlockProtectedEndpoints() throws Exception {
//        mockMvc.perform(get("/api/users/1"))
//                .andExpect(status().isUnauthorized());
//    }
//
//    @Test
//    @WithMockUser
//    void shouldAllowAuthenticatedRequests() throws Exception {
//        mockMvc.perform(get("/api/users/1"))
//                .andExpect(status().isOk());
//    }
//
//    @Test
//    @WithMockUser(roles = "ADMIN")
//    void shouldAllowAdminEndpoints() throws Exception {
//        mockMvc.perform(get("/api/admin/users"))
//                .andExpect(status().isOk());
//    }
//
//    @Test
//    @WithMockUser(roles = "USER")
//    void shouldBlockNonAdminFromAdminEndpoints() throws Exception {
//        mockMvc.perform(get("/api/admin/users"))
//                .andExpect(status().isForbidden());
//    }
//
//    @Test
//    void shouldHandleCorsRequests() throws Exception {
//        mockMvc.perform(options("/api/users/1")
//                .header("Origin", "http://localhost:3000")
//                .header("Access-Control-Request-Method", "GET"))
//                .andExpect(status().isOk())
//                .andExpect(header().exists("Access-Control-Allow-Origin"));
//    }
//}