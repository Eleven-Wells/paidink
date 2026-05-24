// Debounce function to limit API calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Search functionality
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    if (!searchInput || !searchResults) return; // safe guard

    let currentPage = 1;

    // Show loading state
    const showSearchLoading = () => {
        searchResults.classList.remove('hidden');
        searchResults.innerHTML = `
            <div class="p-4">
                <div class="flex items-center justify-center">
                    <div class="animate-shimmer h-4 w-32 bg-gray-200 rounded mr-2"></div>
                </div>
            </div>
        `;
    };

    const performSearch = debounce(async (query, page = 1) => {
        if (query.length < 2) {
            searchResults.classList.add('hidden');
            return;
        }

        showSearchLoading();

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}&limit=6`);

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json();
            const results = data.results || [];

            searchResults.innerHTML = results.length ? results.map(result => `
                <a href="${result.link}" class="block p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <div class="font-semibold text-gray-900">${result.name}</div>
                    <div class="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">${result.description || 'No description available'}</div>
                </a>
            `).join('') : `
                <div class="p-4 text-gray-600 dark:text-gray-400">
                    <i class="fas fa-search mr-2"></i>No results found for "${query}"
                </div>
            `;

            searchResults.classList.remove('hidden');
        } catch (error) {
            console.error('Search error:', error);

            // Show error toast
            if (typeof showErrorToast === 'function') {
                showErrorToast('Search failed. Please try again.', 'Search Error');
            } else if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'Search Error',
                    text: 'Failed to search. Please try again.'
                });
            }

            searchResults.classList.add('hidden');
        }
    }, 300);

    searchInput.addEventListener('input', (e) => {
        currentPage = 1;
        performSearch(e.target.value, currentPage);
    });

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchResults.contains(e.target) && !searchInput.contains(e.target)) {
            searchResults.classList.add('hidden');
        }
    });

    // Keep search open when clicking on results
    if (searchResults) {
        searchResults.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
});
