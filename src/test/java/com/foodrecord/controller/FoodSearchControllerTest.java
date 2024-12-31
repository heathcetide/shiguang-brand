package com.foodrecord.controller;//package com.foodrecord.controller;
//
//import com.foodrecord.dto.SearchCriteria;
//import com.foodrecord.dto.SearchResult;
//import com.foodrecord.service.FoodSearchService;
//import org.junit.jupiter.api.Test;
//import org.springframework.beans.factory.annotation.Autowired;
//import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
//import org.springframework.boot.test.mock.mockito.MockBean;
//import org.springframework.http.MediaType;
//import org.springframework.test.web.servlet.MockMvc;
//import com.fasterxml.jackson.databind.ObjectMapper;
//import java.util.Arrays;
//
//import static org.mockito.Mockito.*;
//import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
//import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
//
//@WebMvcTest(FoodSearchController.class)
//class FoodSearchControllerTest {
//
//    @Autowired
//    private MockMvc mockMvc;
//
//    @Autowired
//    private ObjectMapper objectMapper;
//
//    @MockBean
//    private FoodSearchService searchService;
//
//    @Test
//    void shouldSearchFoodByKeyword() throws Exception {
//        // Given
//        String keyword = "apple";
//        SearchResult result = createSearchResult();
//        when(searchService.searchFood(keyword))
//            .thenReturn(result);
//
//        // When & Then
//        mockMvc.perform(get("/api/foods/search")
//                .param("keyword", keyword))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.items").isArray())
//                .andExpect(jsonPath("$.items[0].name").exists());
//    }
//
//    @Test
//    void shouldSearchWithAdvancedCriteria() throws Exception {
//        // Given
//        SearchCriteria criteria = createSearchCriteria();
//        SearchResult result = createSearchResult();
//        when(searchService.advancedSearch(any()))
//            .thenReturn(result);
//
//        // When & Then
//        mockMvc.perform(post("/api/foods/advanced-search")
//                .contentType(MediaType.APPLICATION_JSON)
//                .content(objectMapper.writeValueAsString(criteria)))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.items").exists());
//    }
//
//    @Test
//    void shouldGetRecentSearches() throws Exception {
//        // Given
//        Long userId = 1L;
//        when(searchService.getRecentSearches(userId))
//            .thenReturn(Arrays.asList("apple", "banana"));
//
//        // When & Then
//        mockMvc.perform(get("/api/foods/recent-searches/{userId}", userId))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$").isArray())
//                .andExpect(jsonPath("$[0]").value("apple"));
//    }
//
//    @Test
//    void shouldHandleEmptySearchResults() throws Exception {
//        // Given
//        String keyword = "nonexistent";
//        when(searchService.searchFood(keyword))
//            .thenReturn(new SearchResult(Arrays.asList(), Arrays.asList()));
//
//        // When & Then
//        mockMvc.perform(get("/api/foods/search")
//                .param("keyword", keyword))
//                .andExpect(status().isOk())
//                .andExpect(jsonPath("$.items").isEmpty());
//    }
//
//    private SearchCriteria createSearchCriteria() {
//        return SearchCriteria.builder()
//            .keyword("salad")
//            .maxCalories(300)
//            .minProtein(10.0)
//            .tags(Arrays.asList("healthy", "vegetarian"))
//            .build();
//    }
//
//    private SearchResult createSearchResult() {
//        return SearchResult.builder()
//            .items(Arrays.asList(
//                createFoodItem("Apple", 95),
//                createFoodItem("Apple Juice", 110)
//            ))
//            .suggestions(Arrays.asList("Try searching for fruits"))
//            .build();
//    }
//
//    private FoodItem createFoodItem(String name, int calories) {
//        return FoodItem.builder()
//            .name(name)
//            .calories(calories)
//            .build();
//    }
//}