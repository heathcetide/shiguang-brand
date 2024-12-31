package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.TagRepository;
//import com.foodrecord.model.Tag;
//import com.foodrecord.dto.TagDTO;
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
//class TagManagementServiceTest {
//
//    @Mock
//    private TagRepository tagRepository;
//
//    @Mock
//    private TagValidator tagValidator;
//
//    @InjectMocks
//    private TagManagementServiceImpl tagService;
//
//    @Test
//    void shouldCreateNewTag() {
//        // Given
//        TagDTO tagDTO = new TagDTO("healthy", "Healthy food options");
//        Tag tag = new Tag();
//        tag.setName("healthy");
//        tag.setDescription("Healthy food options");
//
//        when(tagValidator.validateTag(any())).thenReturn(true);
//        when(tagRepository.save(any(Tag.class))).thenReturn(tag);
//
//        // When
//        Tag result = tagService.createTag(tagDTO);
//
//        // Then
//        assertThat(result.getName()).isEqualTo("healthy");
//        verify(tagRepository).save(any(Tag.class));
//    }
//
//    @Test
//    void shouldUpdateExistingTag() {
//        // Given
//        Long tagId = 1L;
//        TagDTO updateDTO = new TagDTO("healthy-food", "Updated description");
//        Tag existingTag = new Tag();
//        existingTag.setId(tagId);
//        existingTag.setName("healthy");
//
//        when(tagRepository.findById(tagId))
//            .thenReturn(Optional.of(existingTag));
//        when(tagValidator.validateTag(any())).thenReturn(true);
//        when(tagRepository.save(any(Tag.class))).thenReturn(existingTag);
//
//        // When
//        Tag updated = tagService.updateTag(tagId, updateDTO);
//
//        // Then
//        assertThat(updated.getName()).isEqualTo("healthy-food");
//        assertThat(updated.getDescription()).isEqualTo("Updated description");
//    }
//
//    @Test
//    void shouldHandleTagMerge() {
//        // Given
//        Long sourceTagId = 1L;
//        Long targetTagId = 2L;
//        Tag sourceTag = createTag(sourceTagId, "vegetarian");
//        Tag targetTag = createTag(targetTagId, "plant-based");
//
//        when(tagRepository.findById(sourceTagId))
//            .thenReturn(Optional.of(sourceTag));
//        when(tagRepository.findById(targetTagId))
//            .thenReturn(Optional.of(targetTag));
//
//        // When
//        tagService.mergeTags(sourceTagId, targetTagId);
//
//        // Then
//        verify(tagRepository).updateFoodTags(sourceTagId, targetTagId);
//        verify(tagRepository).delete(sourceTag);
//    }
//
//    @Test
//    void shouldValidateTagBeforeCreation() {
//        // Given
//        TagDTO invalidTag = new TagDTO("", "Empty name");
//        when(tagValidator.validateTag(any())).thenReturn(false);
//
//        // When & Then
//        assertThatThrownBy(() -> tagService.createTag(invalidTag))
//            .isInstanceOf(InvalidTagException.class);
//
//        verify(tagRepository, never()).save(any());
//    }
//
//    @Test
//    void shouldGetRelatedTags() {
//        // Given
//        String tagName = "healthy";
//        List<Tag> relatedTags = Arrays.asList(
//            createTag(2L, "low-calorie"),
//            createTag(3L, "nutritious")
//        );
//
//        when(tagRepository.findRelatedTags(tagName))
//            .thenReturn(relatedTags);
//
//        // When
//        List<Tag> result = tagService.getRelatedTags(tagName);
//
//        // Then
//        assertThat(result).hasSize(2);
//        assertThat(result).extracting(Tag::getName)
//            .containsExactly("low-calorie", "nutritious");
//    }
//
//    private Tag createTag(Long id, String name) {
//        Tag tag = new Tag();
//        tag.setId(id);
//        tag.setName(name);
//        return tag;
//    }
//}