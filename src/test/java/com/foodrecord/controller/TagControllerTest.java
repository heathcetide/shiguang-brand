package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.service.TagService;
//import com.foodrecord.dto.TagDTO;
//import com.foodrecord.dto.TagWithCountDTO;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.test.web.servlet.MockMvc;
//import org.springframework.http.MediaType;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import java.util.Arrays;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(TagController.class)
//class TagControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private TagService tagService;
//
//    @Test
//    void shouldCreateTag() throws Exception {
//        // Given
//        TagDTO tagDTO = createTagDTO();
//        when(tagService.createTag(any())).thenReturn(tagDTO);
//
//        // When & Then
//        mockMvc.perform(post("/api/tags")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(tagDTO)))
//                .andExpect(status().isCreated())
//                .andExpect(jsonPath("$.name").value(tagDTO.getName()));
//    }
//
//    @Test
//    void shouldGetUserTags() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(tagService.getUserTags(userId))
//            .thenReturn(Arrays.asList(createTagDTO(), createTagDTO("healthy")));
//
//        // When & Then
//        mockMvc.perform(get("/api/tags/user/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$").isArray())
//                .andExpect(jsonPath("$[0].name").exists());
//    }
//
//    @Test
//    void shouldAddTagToFoodRecord() throws Exception {
//        // Given
//        Long recordId = 1L;
//        Long tagId = 1L;
//        when(tagService.addTagToRecord(recordId, tagId))
//            .thenReturn(true);
//
//        // When & Then
//        mockMvc.perform(post("/api/tags/{tagId}/records/{recordId}", tagId, recordId))
//                .andExpect(status().isOk());
//    }
//
//    @Test
//    void shouldRemoveTagFromFoodRecord() throws Exception {
//        // Given
//        Long recordId = 1L;
//        Long tagId = 1L;
//        doNothing().when(tagService).removeTagFromRecord(recordId, tagId);
//
//        // When & Then
//        mockMvc.perform(delete("/api/tags/{tagId}/records/{recordId}", tagId, recordId))
//                .andExpect(status().isNoContent());
//    }
//
//    @Test
//    void shouldGetPopularTags() throws Exception {
//        // Given
//        when(tagService.getPopularTags())
//            .thenReturn(Arrays.asList(
//                createTagWithCount("healthy", 10),
//                createTagWithCount("vegetarian", 8)
//            ));
//
//        // When & Then
//        mockMvc.perform(get("/api/tags/popular"))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$[0].count").exists());
//    }
//
//    private TagDTO createTagDTO() {
//        return createTagDTO("favorite");
//    }
//
//    private TagDTO createTagDTO(String name) {
//        return TagDTO.builder()
//            .name(name)
//            .description("Tag description")
//            .build();
//    }
//
//    private TagWithCountDTO createTagWithCount(String name, int count) {
//        return TagWithCountDTO.builder()
//            .name(name)
//            .count(count)
//            .build();
//    }
//}