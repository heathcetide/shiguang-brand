package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.FoodRepository;
//import com.foodrecord.model.Food;
//import com.foodrecord.dto.SearchCriteria;
//import com.foodrecord.dto.SearchResult;
//import com.foodrecord.model.FoodItem;
//import com.foodrecord.repository.FoodItemRepository;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Arrays;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class FoodSearchServiceTest {
//
//    @Mock
//    private FoodRepository foodRepository;
//
//    @Mock
//    private SearchOptimizer searchOptimizer;
//
//    @Mock
//    private NutritionFilter nutritionFilter;
//
//    @InjectMocks
//    private FoodSearchServiceImpl searchService;
//
//    @Mock
//    private FoodItemRepository foodItemRepository;
//
//    @Mock
//    private SearchHistoryManager searchHistoryManager;
//
//    @Test
//    void shouldSearchFoodByKeyword() {
//        // Given
//        String keyword = "apple";
//        List<Food> foods = Arrays.asList(
//            createFood("Green Apple", 52),
//            createFood("Apple Pie", 237)
//        );
//
//        when(foodRepository.findByNameContainingIgnoreCase(keyword))
//            .thenReturn(foods);
//        when(searchOptimizer.optimizeResults(any(), any()))
//            .thenReturn(foods);
//
//        // When
//        SearchResult result = searchService.searchFood(keyword);
//
//        // Then
//        assertThat(result.getItems()).hasSize(2);
//        assertThat(result.getItems().get(0).getName()).contains("Apple");
//        verify(searchOptimizer).optimizeResults(eq(foods), any());
//    }
//
//    @Test
//    void shouldFilterByNutritionCriteria() {
//        // Given
//        SearchCriteria criteria = SearchCriteria.builder()
//            .maxCalories(200)
//            .minProtein(5.0)
//            .build();
//
//        List<Food> foods = Arrays.asList(
//            createFoodWithNutrition("Chicken Breast", 165, 31.0),
//            createFoodWithNutrition("Salmon", 208, 22.0)
//        );
//
//        when(foodRepository.findAll()).thenReturn(foods);
//        when(nutritionFilter.filterByNutrition(any(), any()))
//            .thenReturn(Arrays.asList(foods.get(0)));
//
//        // When
//        List<Food> results = searchService.searchByNutrition(criteria);
//
//        // Then
//        assertThat(results).hasSize(1);
//        assertThat(results.get(0).getName()).isEqualTo("Chicken Breast");
//    }
//
//    @Test
//    void shouldSearchByMultipleCriteria() {
//        // Given
//        SearchCriteria criteria = SearchCriteria.builder()
//            .keyword("salad")
//            .maxCalories(300)
//            .tags(Arrays.asList("healthy", "vegetarian"))
//            .build();
//
//        List<Food> foods = Arrays.asList(
//            createFoodWithTags("Greek Salad", 265, "healthy", "vegetarian"),
//            createFoodWithTags("Caesar Salad", 290, "healthy")
//        );
//
//        when(foodRepository.findByNameAndTags(any(), any()))
//            .thenReturn(foods);
//        when(nutritionFilter.filterByNutrition(any(), any()))
//            .thenReturn(Arrays.asList(foods.get(0)));
//
//        // When
//        SearchResult results = searchService.advancedSearch(criteria);
//
//        // Then
//        assertThat(results.getItems()).hasSize(1);
//        assertThat(results.getItems().get(0).getTags())
//            .containsAll(Arrays.asList("healthy", "vegetarian"));
//    }
//
//    @Test
//    void shouldHandleEmptySearchResults() {
//        // Given
//        String keyword = "nonexistent";
//        when(foodRepository.findByNameContainingIgnoreCase(keyword))
//            .thenReturn(Arrays.asList());
//
//        // When
//        SearchResult result = searchService.searchFood(keyword);
//
//        // Then
//        assertThat(result.getItems()).isEmpty();
//        assertThat(result.getSuggestions()).isNotEmpty();
//        verify(searchOptimizer).generateSuggestions(keyword);
//    }
//
//    @Test
//    void shouldSearchFoodByName() {
//        // Given
//        String query = "apple";
//        when(foodItemRepository.findByNameContainingIgnoreCase(query))
//            .thenReturn(Arrays.asList(
//                createFoodItem("Apple", 95),
//                createFoodItem("Apple Juice", 110)
//            ));
//
//        // When
//        List<FoodItem> results = searchService.searchFood(query);
//
//        // Then
//        assertThat(results).hasSize(2);
//        assertThat(results).allMatch(food ->
//            food.getName().toLowerCase().contains(query));
//    }
//
//    @Test
//    void shouldSearchWithCriteria() {
//        // Given
//        SearchCriteria criteria = SearchCriteria.builder()
//            .maxCalories(200)
//            .minProtein(15.0)
//            .category("protein")
//            .build();
//
//        when(foodItemRepository.findByCriteria(criteria))
//            .thenReturn(Arrays.asList(
//                createFoodItem("Chicken Breast", 165, 31.0),
//                createFoodItem("Tuna", 180, 25.0)
//            ));
//
//        // When
//        List<FoodItem> results = searchService.searchWithCriteria(criteria);
//
//        // Then
//        assertThat(results).hasSize(2);
//        assertThat(results).allMatch(food ->
//            food.getCalories() <= 200 && food.getProteinContent() >= 15.0);
//    }
//
//    @Test
//    void shouldReturnRecentSearches() {
//        // Given
//        Long userId = 1L;
//        when(searchHistoryManager.getRecentSearches(userId))
//            .thenReturn(Arrays.asList("apple", "banana", "chicken"));
//
//        // When
//        List<String> recentSearches = searchService.getRecentSearches(userId);
//
//        // Then
//        assertThat(recentSearches).hasSize(3);
//        assertThat(recentSearches).contains("apple", "banana", "chicken");
//    }
//
//    @Test
//    void shouldHandleEmptySearchResults() {
//        // Given
//        String query = "nonexistent";
//        when(foodItemRepository.findByNameContainingIgnoreCase(query))
//            .thenReturn(Arrays.asList());
//
//        // When
//        List<FoodItem> results = searchService.searchFood(query);
//
//        // Then
//        assertThat(results).isEmpty();
//    }
//
//    @Test
//    void shouldSaveSearchHistory() {
//        // Given
//        Long userId = 1L;
//        String query = "apple";
//
//        // When
//        searchService.searchFood(query, userId);
//
//        // Then
//        verify(searchHistoryManager).saveSearch(userId, query);
//    }
//
//    private Food createFood(String name, int calories) {
//        return Food.builder()
//            .name(name)
//            .calories(calories)
//            .build();
//    }
//
//    private Food createFoodWithNutrition(String name, int calories, double protein) {
//        return Food.builder()
//            .name(name)
//            .calories(calories)
//            .protein(protein)
//            .build();
//    }
//
//    private Food createFoodWithTags(String name, int calories, String... tags) {
//        return Food.builder()
//            .name(name)
//            .calories(calories)
//            .tags(Arrays.asList(tags))
//            .build();
//    }
//
//    private FoodItem createFoodItem(String name, int calories) {
//        return createFoodItem(name, calories, 0.0);
//    }
//
//    private FoodItem createFoodItem(String name, int calories, double protein) {
//        return FoodItem.builder()
//            .name(name)
//            .calories(calories)
//            .proteinContent(protein)
//            .build();
//    }
//}