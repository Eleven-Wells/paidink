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

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    if (!searchInput || !searchResults) return;

    let currentPage = 1;

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
            const [toolsRes, postsRes] = await Promise.all([
                fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}&limit=3`),
                fetch(`/api/search/posts?q=${encodeURIComponent(query)}&page=${page}&limit=3`)
            ]);

            const toolsData = toolsRes.ok ? await toolsRes.json() : { results: [] };
            const postsData = postsRes.ok ? await postsRes.json() : { results: [] };

            const tools = (toolsData.results || []).map(t => ({
                href: t.link,
                title: t.name,
                description: t.description || 'No description available',
                type: 'tool'
            }));
            const posts = (postsData.results || []).map(p => ({
                href: '/post/' + p.slug,
                title: p.title,
                description: p.summary || 'No description available',
                type: 'post'
            }));

            const allResults = [...tools, ...posts];

            searchResults.innerHTML = allResults.length ? allResults.map(r => `
                <a href="${r.href}" class="block p-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <div class="flex items-start gap-2">
                        <span class="text-xs font-mono uppercase text-gray-400 mt-0.5 shrink-0">${r.type}</span>
                        <div class="min-w-0">
                            <div class="font-semibold text-gray-900 dark:text-white text-sm truncate">${r.title}</div>
                            <div class="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">${r.description}</div>
                        </div>
                    </div>
                </a>
            `).join('') + `
                <a href="/search?q=${encodeURIComponent(query)}" class="block p-3 text-center text-sm text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium">
                    View all results →
                </a>
            ` : `
                <div class="p-4 text-gray-500 dark:text-gray-400 text-sm">
                    No results found for "${query}"
                </div>
            `;

            searchResults.classList.remove('hidden');
        } catch (error) {
            console.error('Search error:', error);
            searchResults.classList.add('hidden');
        }
    }, 300);

    searchInput.addEventListener('input', (e) => {
        currentPage = 1;
        performSearch(e.target.value, currentPage);
    });

    document.addEventListener('click', (e) => {
        if (!searchResults.contains(e.target) && !searchInput.contains(e.target)) {
            searchResults.classList.add('hidden');
        }
    });

    if (searchResults) {
        searchResults.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
});