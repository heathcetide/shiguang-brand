package com.foodrecord.service;//package com.foodrecord.service;
//
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.util.Arrays;
//import java.util.List;
//import java.util.Set;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class DietaryRestrictionValidatorTest {
//
//    @Mock
//    private DietaryRestrictionProvider restrictionProvider;
//
//    @InjectMocks
//    private DietaryRestrictionValidatorImpl validator;
//
//    @Test
//    void shouldValidateValidRestrictions() {
//        // Given
//        List<String> restrictions = Arrays.asList("vegetarian", "gluten-free");
//        when(restrictionProvider.getValidRestrictions())
//            .thenReturn(Set.of("vegetarian", "vegan", "gluten-free"));
//
//        // When
//        boolean isValid = validator.validateRestrictions(restrictions);
//
//        // Then
//        assertThat(isValid).isTrue();
//        assertThat(validator.getErrors()).isEmpty();
//    }
//
//    @Test
//    void shouldDetectInvalidRestriction() {
//        // Given
//        List<String> restrictions = Arrays.asList("invalid-diet", "vegetarian");
//        when(restrictionProvider.getValidRestrictions())
//            .thenReturn(Set.of("vegetarian", "vegan"));
//
//        // When
//        boolean isValid = validator.validateRestrictions(restrictions);
//
//        // Then
//        assertThat(isValid).isFalse();
//        assertThat(validator.getErrors())
//            .contains("Invalid dietary restriction: invalid-diet");
//    }
//
//    @Test
//    void shouldHandleConflictingRestrictions() {
//        // Given
//        List<String> restrictions = Arrays.asList("vegan", "pescatarian");
//        when(restrictionProvider.getConflictingPairs())
//            .thenReturn(Set.of(new RestrictionPair("vegan", "pescatarian")));
//
//        // When
//        boolean isValid = validator.validateRestrictions(restrictions);
//
//        // Then
//        assertThat(isValid).isFalse();
//        assertThat(validator.getErrors())
//            .contains("Conflicting restrictions: vegan and pescatarian");
//    }
//
//    @Test
//    void shouldHandleEmptyRestrictions() {
//        // Given
//        List<String> restrictions = Arrays.asList();
//
//        // When
//        boolean isValid = validator.validateRestrictions(restrictions);
//
//        // Then
//        assertThat(isValid).isTrue();
//        assertThat(validator.getErrors()).isEmpty();
//    }
//
//    @Test
//    void shouldValidateRestrictionCombinations() {
//        // Given
//        List<String> restrictions = Arrays.asList(
//            "gluten-free", "dairy-free", "low-carb"
//        );
//        when(restrictionProvider.getValidRestrictions())
//            .thenReturn(Set.of("gluten-free", "dairy-free", "low-carb"));
//        when(restrictionProvider.getMaxRestrictions()).thenReturn(3);
//
//        // When
//        boolean isValid = validator.validateRestrictions(restrictions);
//
//        // Then
//        assertThat(isValid).isTrue();
//        verify(restrictionProvider).getMaxRestrictions();
//    }
//}