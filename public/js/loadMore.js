document.addEventListener('DOMContentLoaded', () => {
    const loadMoreBtn = document.getElementById('load-more');
    const blogsContainer = document.getElementById('articlesContainer');
    const isMobile = window.innerWidth < 768; // Mobile detection

    if (!blogsContainer) return;

    // Create mobile scroll indicator
    let scrollIndicator = null;
    if (isMobile) {
        scrollIndicator = document.createElement('div');
        scrollIndicator.id = 'scroll-indicator';
        scrollIndicator.className = 'fixed bottom-0 left-0 right-0 bg-indigo-600 text-white text-center py-3 text-sm font-medium z-40 transform translate-y-full transition-transform duration-300';
        scrollIndicator.textContent = 'Scroll up to load more content';
        document.body.appendChild(scrollIndicator);
    }

    // Hide load more button on mobile
    if (loadMoreBtn && isMobile) {
        loadMoreBtn.style.display = 'none';
    }

    // Get current page and total from container or button
    function getCurrentPage() {
        return parseInt((loadMoreBtn ? loadMoreBtn.getAttribute('data-page') : blogsContainer.getAttribute('data-page')) || '1');
    }

    function getTotalPages() {
        return parseInt((loadMoreBtn ? loadMoreBtn.getAttribute('data-total') : blogsContainer.getAttribute('data-total')) || '1');
    }

    function setCurrentPage(page) {
        if (loadMoreBtn) loadMoreBtn.setAttribute('data-page', page);
        blogsContainer.setAttribute('data-page', page);
    }

    let isLoading = false;
    let hasReachedBottom = false;
    let lastScrollTop = 0;

    async function loadMoreContent() {
        if (isLoading) return;

        const currentPage = getCurrentPage();
        const totalPages = getTotalPages();
        const nextPage = currentPage + 1;

        if (nextPage > totalPages) {
            if (isMobile && scrollIndicator) {
                scrollIndicator.textContent = 'No more content available';
                scrollIndicator.classList.remove('translate-y-full');
                setTimeout(() => {
                    if (scrollIndicator) scrollIndicator.classList.add('translate-y-full');
                }, 3000);
            } else if (loadMoreBtn) {
                loadMoreBtn.textContent = 'No more articles';
                loadMoreBtn.disabled = true;
            }
            return;
        }

        isLoading = true;

        // Show shimmer loader while fetching
        const shimmerLoader = document.createElement('div');
        shimmerLoader.id = 'shimmer-loader';
        shimmerLoader.innerHTML = getShimmerLoaderHTML();
        blogsContainer.appendChild(shimmerLoader);

        if (isMobile && scrollIndicator) {
            scrollIndicator.textContent = 'Loading more content...';
            scrollIndicator.classList.remove('translate-y-full');
        } else if (loadMoreBtn) {
            loadMoreBtn.disabled = true;
            loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Loading...';
        }

        try {
            const category = new URLSearchParams(window.location.search).get('category') || '';
            const url = category ? `/api/posts?page=${nextPage}&limit=12&category=${encodeURIComponent(category)}` : `/api/posts?page=${nextPage}&limit=12`;
            const resp = await fetch(url);

            if (!resp.ok) {
                throw new Error(`Server error: ${resp.status}`);
            }

            const data = await resp.json();
            const blogs = data.posts || [];

            // Remove shimmer loader
            const shimmer = document.getElementById('shimmer-loader');
            if (shimmer) shimmer.remove();

            const html = blogs.map(blog => `
                <article onclick="window.location.href='/post/${blog.slug}'" class="card-hover bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer group fade-up">
                    <div class="md:flex">
                        <div class="md:w-1/3 relative overflow-hidden">
                            <img src="${blog.image || '/public/images/placeholder.jpg'}" alt="${blog.title}" class="w-full h-48 md:h-full object-cover image-zoom" onerror="this.src='/public/images/placeholder.jpg'; this.alt='Image not available';">
                            <div class="absolute top-4 left-4">
                                <span class="bg-indigo-600 text-white px-3 py-1 rounded-full text-sm font-medium">${blog.category}</span>
                            </div>
                        </div>
                        <div class="md:w-2/3 p-6">
                            <div class="flex items-center text-sm text-gray-500 mb-3">
                                <span class="flex items-center mr-4">
                                    <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                    </svg>
                                    ${Math.ceil((blog.content || '').length / 1000) || 5} min read
                                </span>
                                <span>${new Date(blog.publishedAt).toLocaleDateString()}</span>
                            </div>
                            <h3 class="text-xl font-bold text-gray-900 mb-3 group-hover:text-indigo-600 transition-colors">${blog.title}</h3>
                            <p class="text-gray-600 leading-relaxed mb-4">${blog.summary || blog.content.substring(0, 200) + '...'}</p>
                            <div class="flex items-center justify-between">
                                <div class="flex items-center space-x-2">
                                    ${blog.tags && blog.tags.length > 0 ? blog.tags.slice(0, 3).map(tag => `<span class="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">${tag}</span>`).join('') : ''}
                                </div>
                                <span class="text-indigo-600 font-medium group-hover:translate-x-1 transition-transform">Read article →</span>
                            </div>
                        </div>
                    </div>
                </article>
            `).join('');

            blogsContainer.insertAdjacentHTML('beforeend', html);
            setCurrentPage(nextPage);

            // Update UI
            if (nextPage >= totalPages) {
                if (isMobile && scrollIndicator) {
                    scrollIndicator.textContent = 'No more content available';
                    setTimeout(() => {
                        if (scrollIndicator) scrollIndicator.classList.add('translate-y-full');
                    }, 3000);
                } else if (loadMoreBtn) {
                    loadMoreBtn.textContent = 'No more articles';
                    loadMoreBtn.disabled = true;
                }
            } else {
                if (isMobile && scrollIndicator) {
                    scrollIndicator.classList.add('translate-y-full');
                } else if (loadMoreBtn) {
                    loadMoreBtn.innerHTML = '<i class="fas fa-plus mr-2"></i> Load more';
                    loadMoreBtn.disabled = false;
                }
            }
        } catch (err) {
            console.error('Load more error:', err);

            // Remove shimmer loader on error
            const shimmer = document.getElementById('shimmer-loader');
            if (shimmer) shimmer.remove();

            // Show error toast
            if (typeof showErrorToast === 'function') {
                showErrorToast('Failed to load more articles. Please check your connection and try again.', 'Loading Error');
            } else if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'error',
                    title: 'Loading Error',
                    text: 'Failed to load more articles. Please check your connection and try again.'
                });
            }

            if (isMobile && scrollIndicator) {
                scrollIndicator.textContent = 'Error loading content';
                setTimeout(() => {
                    if (scrollIndicator) scrollIndicator.classList.add('translate-y-full');
                }, 3000);
            } else if (loadMoreBtn) {
                loadMoreBtn.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i> Error loading';
                loadMoreBtn.disabled = false;
            }
        } finally {
            isLoading = false;
            hasReachedBottom = false;
        }
    }

    // Desktop: Load more button
    if (loadMoreBtn && !isMobile) {
        loadMoreBtn.addEventListener('click', loadMoreContent);
    }

    // Mobile: Pull-up-to-load-more
    if (isMobile) {
        window.addEventListener('scroll', () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const windowHeight = window.innerHeight;
            const documentHeight = document.documentElement.scrollHeight;

            // Check if user scrolled to bottom
            if (scrollTop + windowHeight >= documentHeight - 100 && !hasReachedBottom && !isLoading) {
                hasReachedBottom = true;
                if (scrollIndicator) {
                    scrollIndicator.classList.remove('translate-y-full');
                }
            }

            // Check if user scrolled up after reaching bottom
            if (hasReachedBottom && scrollTop < lastScrollTop - 50 && !isLoading) {
                loadMoreContent();
            }

            lastScrollTop = scrollTop;
        });
    }
});
