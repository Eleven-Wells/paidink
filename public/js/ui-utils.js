// UI Utilities - Shimmer Loaders and Error Toasts

// Show shimmer loader
function showShimmerLoader(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const shimmerHTML = `
        <div class="shimmer-container">
            ${[1, 2, 3, 4, 5, 6].map(i => `
                <div class="shimmer-card bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
                    <div class="shimmer-image animate-shimmer h-48 bg-gray-200"></div>
                    <div class="p-6">
                        <div class="shimmer-tag animate-shimmer h-6 w-24 bg-gray-200 rounded-full mb-3"></div>
                        <div class="shimmer-title animate-shimmer h-7 bg-gray-200 rounded mb-2"></div>
                        <div class="shimmer-title animate-shimmer h-7 w-3/4 bg-gray-200 rounded mb-4"></div>
                        <div class="shimmer-text animate-shimmer h-4 bg-gray-200 rounded mb-2"></div>
                        <div class="shimmer-text animate-shimmer h-4 w-5/6 bg-gray-200 rounded mb-4"></div>
                        <div class="flex justify-between">
                            <div class="shimmer-tags animate-shimmer h-6 w-32 bg-gray-200 rounded"></div>
                            <div class="shimmer-btn animate-shimmer h-6 w-28 bg-gray-200 rounded"></div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    container.innerHTML = shimmerHTML;
}

// Show inline shimmer loader for appending content
function getShimmerLoaderHTML() {
    return `
        <div class="shimmer-card bg-white rounded-xl border border-gray-200 overflow-hidden mb-4 fade-up">
            <div class="shimmer-image animate-shimmer h-48 bg-gray-200"></div>
            <div class="p-6">
                <div class="shimmer-tag animate-shimmer h-6 w-24 bg-gray-200 rounded-full mb-3"></div>
                <div class="shimmer-title animate-shimmer h-7 bg-gray-200 rounded mb-2"></div>
                <div class="shimmer-title animate-shimmer h-7 w-3/4 bg-gray-200 rounded mb-4"></div>
                <div class="shimmer-text animate-shimmer h-4 bg-gray-200 rounded mb-2"></div>
                <div class="shimmer-text animate-shimmer h-4 w-5/6 bg-gray-200 rounded mb-4"></div>
                <div class="flex justify-between">
                    <div class="shimmer-tags animate-shimmer h-6 w-32 bg-gray-200 rounded"></div>
                    <div class="shimmer-btn animate-shimmer h-6 w-28 bg-gray-200 rounded"></div>
                </div>
            </div>
        </div>
    `;
}

// Show success toast using SweetAlert2
function showSuccessToast(message, title = 'Success') {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'success',
            title: title,
            text: message,
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: '#ffffff',
            iconColor: '#10b981',
            customClass: {
                title: 'text-gray-800 font-semibold',
                content: 'text-gray-600'
            }
        });
    } else {
        // Fallback to native alert
        alert(message);
    }
}

// Show error toast
function showErrorToast(message, title = 'Error') {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'error',
            title: title,
            text: message,
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 4000,
            timerProgressBar: true,
            background: '#ffffff',
            iconColor: '#ef4444',
            customClass: {
                title: 'text-gray-800 font-semibold',
                content: 'text-gray-600'
            }
        });
    } else {
        console.error(message);
    }
}

// Show warning toast
function showWarningToast(message, title = 'Warning') {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'warning',
            title: title,
            text: message,
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3500,
            timerProgressBar: true,
            background: '#ffffff',
            iconColor: '#f59e0b',
            customClass: {
                title: 'text-gray-800 font-semibold',
                content: 'text-gray-600'
            }
        });
    }
}

// Show info toast
function showInfoToast(message, title = 'Info') {
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'info',
            title: title,
            text: message,
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true,
            background: '#ffffff',
            iconColor: '#3b82f6',
            customClass: {
                title: 'text-gray-800 font-semibold',
                content: 'text-gray-600'
            }
        });
    }
}

// Handle image error with fallback
function handleImageError(img) {
    img.onerror = function () {
        this.src = '/public/images/placeholder.jpg';
        this.alt = 'Image not available';
    };
}

// Add shimmer animation styles to document
function injectShimmerStyles() {
    if (document.getElementById('shimmer-styles')) return;

    const style = document.createElement('style');
    style.id = 'shimmer-styles';
    style.textContent = `
        @keyframes shimmer {
            0% {
                background-position: -200% 0;
            }
            100% {
                background-position: 200% 0;
            }
        }
        
        .animate-shimmer {
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
        }
        
        .shimmer-card {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .shimmer-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
    `;
    document.head.appendChild(style);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function () {
    injectShimmerStyles();

    // Auto-handle all images with data-src attribute
    document.querySelectorAll('img[data-src]').forEach(img => {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
    });

    // Add error handling to all article images
    document.querySelectorAll('article img, .card img, .blog-image img').forEach(handleImageError);
});
