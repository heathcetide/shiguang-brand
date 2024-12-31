package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.model.FoodItem;
//import com.foodrecord.repository.FoodItemRepository;
//import com.foodrecord.dto.FoodCategory;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Arrays;
//import java.util.List;
//import java.util.Optional;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class FoodDatabaseServiceTest {
//
//    @Mock
//    private FoodItemRepository foodItemRepository;
//
//    @Mock
//    private NutritionDataValidator nutritionValidator;
//
//    @InjectMocks
//    private FoodDatabaseServiceImpl foodDatabaseService;
//
//    @Test
//    void shouldAddNewFoodItem() {
//        // Given
//        FoodItem newFood = createFoodItem("Quinoa Bowl", 350);
//        when(nutritionValidator.validate(any())).thenReturn(true);
//        when(foodItemRepository.save(any())).thenReturn(newFood);
//
//        // When
//        FoodItem savedFood = foodDatabaseService.addFoodItem(newFood);
//
//        // Then
//        assertThat(savedFood).isNotNull();
//        verify(foodItemRepository).save(newFood);
//    }
//
//    @Test
//    void shouldGetFoodByCategory() {
//        // Given
//        FoodCategory category = FoodCategory.PROTEIN;
//        List<FoodItem> proteinFoods = Arrays.asList(
//            createFoodItem("Chicken", 165),
//            createFoodItem("Fish", 180)
//        );
//
//        when(foodItemRepository.findByCategory(category))
//            .thenReturn(proteinFoods);
//
//        // When
//        List<FoodItem> foods = foodDatabaseService.getFoodsByCategory(category);
//
//        // Then
//        assertThat(foods).hasSize(2);
//        assertThat(foods).allMatch(food -> food.getProteinContent() > 20);
//    }
//
//    @Test
//    void shouldUpdateFoodItem() {
//        // Given
//        Long foodId = 1L;
//        FoodItem existingFood = createFoodItem("Apple", 95);
//        FoodItem updatedFood = createFoodItem("Green Apple", 90);
//
//        when(foodItemRepository.findById(foodId))
//            .thenReturn(Optional.of(existingFood));
//        when(nutritionValidator.validate(any())).thenReturn(true);
//        when(foodItemRepository.save(any())).thenReturn(updatedFood);
//
//        // When
//        FoodItem result = foodDatabaseService.updateFoodItem(foodId, updatedFood);
//
//        // Then
//        assertThat(result.getName()).isEqualTo("Green Apple");
//        assertThat(result.getCalories()).isEqualTo(90);
//    }
//
//    @Test
//    void shouldValidateNutritionData() {
//        // Given
//        FoodItem invalidFood = createInvalidFoodItem();
//        when(nutritionValidator.validate(any())).thenReturn(false);
//
//        // When & Then
//        assertThatThrownBy(() -> foodDatabaseService.addFoodItem(invalidFood))
//            .isInstanceOf(InvalidNutritionDataException.class);
//    }
//
//    @Test
//    void shouldGetCommonFoods() {
//        // Given
//        when(foodItemRepository.findCommonFoods())
//            .thenReturn(Arrays.asList(
//                createFoodItem("Apple", 95),
//                createFoodItem("Banana", 105)
//            ));
//
//        // When
//        List<FoodItem> commonFoods = foodDatabaseService.getCommonFoods();
//
//        // Then
//        assertThat(commonFoods).hasSize(2);
//        verify(foodItemRepository).findCommonFoods();
//    }
//
//    private FoodItem createFoodItem(String name, int calories) {
//        return FoodItem.builder()
//            .name(name)
//            .calories(calories)
//            .proteinContent(name.equals("Chicken") ? 31.0 :
//                          name.equals("Fish") ? 25.0 : 0.0)
//            .build();
//    }
//
//    private FoodItem createInvalidFoodItem() {
//        return FoodItem.builder()
//            .name("")
//            .calories(-100)
//            .build();
//    }
//}