package com.foodrecord.service;//package com.foodrecord.service;
//
//import com.foodrecord.repository.SearchHistoryRepository;
//import com.foodrecord.model.SearchHistory;
//import org.junit.jupiter.api.Test;
//import org.junit.jupiter.api.extension.ExtendWith;
//import org.mockito.InjectMocks;
//import org.mockito.Mock;
//import org.mockito.junit.jupiter.MockitoExtension;
//import java.time.LocalDateTime;
//import java.util.Arrays;
//import java.util.List;
//
//import static org.mockito.Mockito.*;
//import static org.assertj.core.api.Assertions.*;
//
//@ExtendWith(MockitoExtension.class)
//class SearchHistoryManagerTest {
//
//    @Mock
//    private SearchHistoryRepository historyRepository;
//
//    @InjectMocks
//    private SearchHistoryManagerImpl historyManager;
//
//    @Test
//    void shouldSaveSearchHistory() {
//        // Given
//        Long userId = 1L;
//        String query = "chicken";
//        SearchHistory history = createSearchHistory(userId, query);
//
//        when(historyRepository.save(any(SearchHistory.class)))
//            .thenReturn(history);
//
//        // When
//        historyManager.saveSearch(userId, query);
//
//        // Then
//        verify(historyRepository).save(argThat(h ->
//            h.getUserId().equals(userId) &&
//            h.getQuery().equals(query)
//        ));
//    }
//
//    @Test
//    void shouldGetRecentSearches() {
//        // Given
//        Long userId = 1L;
//        List<SearchHistory> histories = Arrays.asList(
//            createSearchHistory(userId, "apple"),
//            createSearchHistory(userId, "banana"),
//            createSearchHistory(userId, "chicken")
//        );
//
//        when(historyRepository.findRecentByUserId(userId, 10))
//            .thenReturn(histories);
//
//        // When
//        List<String> recentSearches = historyManager.getRecentSearches(userId);
//
//        // Then
//        assertThat(recentSearches).hasSize(3);
//        assertThat(recentSearches).containsExactly("apple", "banana", "chicken");
//    }
//
//    @Test
//    void shouldRemoveDuplicateSearches() {
//        // Given
//        Long userId = 1L;
//        String query = "apple";
//
//        when(historyRepository.findByUserIdAndQuery(userId, query))
//            .thenReturn(Optional.of(createSearchHistory(userId, query)));
//
//        // When
//        historyManager.saveSearch(userId, query);
//
//        // Then
//        verify(historyRepository).delete(any(SearchHistory.class));
//        verify(historyRepository).save(any(SearchHistory.class));
//    }
//
//    @Test
//    void shouldClearOldSearchHistory() {
//        // Given
//        Long userId = 1L;
//        LocalDateTime cutoffDate = LocalDateTime.now().minusDays(30);
//
//        // When
//        historyManager.clearOldSearches(userId, cutoffDate);
//
//        // Then
//        verify(historyRepository).deleteByUserIdAndSearchTimeBefore(userId, cutoffDate);
//    }
//
//    private SearchHistory createSearchHistory(Long userId, String query) {
//        return SearchHistory.builder()
//            .userId(userId)
//            .query(query)
//            .searchTime(LocalDateTime.now())
//            .build();
//    }
//}