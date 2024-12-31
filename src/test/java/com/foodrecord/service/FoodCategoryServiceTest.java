package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.FoodCategoryRepository;
//import com.foodrecord.model.FoodCategory;
//import com.foodrecord.dto.FoodCategoryDTO;
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
//class FoodCategoryServiceTest {
//
//    @Mock
//    private FoodCategoryRepository categoryRepository;
//
//    @Mock
//    private FoodCategoryMapper categoryMapper;
//
//    @Mock
//    private NutritionDataProvider nutritionDataProvider;
//
//    @InjectMocks
//    private FoodCategoryServiceImpl categoryService;
//
//    @Test
//    void shouldCreateFoodCategory() {
//        // Given
//        FoodCategoryDTO categoryDTO = new FoodCategoryDTO();
//        categoryDTO.setName("Fruits");
//        categoryDTO.setDescription("Fresh fruits");
//
//        FoodCategory category = new FoodCategory();
//        category.setId(1L);
//        category.setName("Fruits");
//
//        when(categoryMapper.toEntity(categoryDTO)).thenReturn(category);
//        when(categoryRepository.save(any(FoodCategory.class))).thenReturn(category);
//
//        // When
//        FoodCategory result = categoryService.createCategory(categoryDTO);
//
//        // Then
//        assertThat(result).isNotNull();
//        assertThat(result.getName()).isEqualTo("Fruits");
//        verify(categoryRepository).save(any(FoodCategory.class));
//    }
//
//    @Test
//    void shouldGetCategoryWithNutritionInfo() {
//        // Given
//        Long categoryId = 1L;
//        FoodCategory category = new FoodCategory();
//        category.setId(categoryId);
//        category.setName("Vegetables");
//
//        NutritionInfo nutritionInfo = NutritionInfo.builder()
//            .averageCalories(50)
//            .averageProtein(2.0)
//            .build();
//
//        when(categoryRepository.findById(categoryId))
//            .thenReturn(Optional.of(category));
//        when(nutritionDataProvider.getCategoryNutritionInfo(category))
//            .thenReturn(nutritionInfo);
//
//        // When
//        CategoryDetails details = categoryService.getCategoryDetails(categoryId);
//
//        // Then
//        assertThat(details.getCategory()).isEqualTo(category);
//        assertThat(details.getNutritionInfo().getAverageCalories()).isEqualTo(50);
//    }
//
//    @Test
//    void shouldUpdateCategoryHierarchy() {
//        // Given
//        Long parentId = 1L;
//        Long childId = 2L;
//
//        FoodCategory parent = new FoodCategory();
//        parent.setId(parentId);
//        parent.setName("Dairy");
//
//        FoodCategory child = new FoodCategory();
//        child.setId(childId);
//        child.setName("Yogurt");
//
//        when(categoryRepository.findById(parentId)).thenReturn(Optional.of(parent));
//        when(categoryRepository.findById(childId)).thenReturn(Optional.of(child));
//        when(categoryRepository.save(any(FoodCategory.class))).thenReturn(child);
//
//        // When
//        categoryService.updateCategoryHierarchy(childId, parentId);
//
//        // Then
//        verify(categoryRepository).save(argThat(category ->
//            category.getId().equals(childId) &&
//            category.getParentCategory().getId().equals(parentId)
//        ));
//    }
//
//    @Test
//    void shouldSearchCategoriesByNutritionCriteria() {
//        // Given
//        NutritionCriteria criteria = NutritionCriteria.builder()
//            .minProtein(5.0)
//            .maxCalories(300)
//            .build();
//
//        List<FoodCategory> matchingCategories = Arrays.asList(
//            createCategory(1L, "Lean Meat"),
//            createCategory(2L, "Fish")
//        );
//
//        when(categoryRepository.findByNutritionCriteria(
//            criteria.getMinProtein(),
//            criteria.getMaxCalories()))
//            .thenReturn(matchingCategories);
//
//        // When
//        List<FoodCategory> results = categoryService.searchByNutrition(criteria);
//
//        // Then
//        assertThat(results).hasSize(2);
//        assertThat(results.get(0).getName()).isEqualTo("Lean Meat");
//    }
//
//    private FoodCategory createCategory(Long id, String name) {
//        FoodCategory category = new FoodCategory();
//        category.setId(id);
//        category.setName(name);
//        return category;
//    }
//}