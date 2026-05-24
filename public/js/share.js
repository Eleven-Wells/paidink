// Share functionality
document.addEventListener('DOMContentLoaded', () => {
    const shareButton = document.getElementById('share-button');

    shareButton.addEventListener('click', async () => {
        const title = document.title;
        const url = window.location.href;

        // Check if Web Share API is available
        if (navigator.share) {
            try {
                await navigator.share({
                    title: title,
                    url: url
                });
            } catch (err) {
                showFallbackShare();
            }
        } else {
            showFallbackShare();
        }
    });

    function showFallbackShare() {
        const url = encodeURIComponent(window.location.href);
        const title = encodeURIComponent(document.title);

        Swal.fire({
            title: 'Share this article',
            html: `
                <div class="flex justify-center space-x-4">
                    <a href="https://twitter.com/intent/tweet?url=${url}&text=${title}" 
                       target="_blank" 
                       class="text-blue-400 hover:text-blue-600 text-2xl">
                        <i class="fab fa-twitter"></i>
                    </a>
                    <a href="https://www.facebook.com/sharer/sharer.php?u=${url}" 
                       target="_blank"
                       class="text-blue-600 hover:text-blue-800 text-2xl">
                        <i class="fab fa-facebook"></i>
                    </a>
                    <a href="https://www.linkedin.com/shareArticle?mini=true&url=${url}&title=${title}" 
                       target="_blank"
                       class="text-blue-700 hover:text-blue-900 text-2xl">
                        <i class="fab fa-linkedin"></i>
                    </a>
                    <button onclick="navigator.clipboard.writeText(window.location.href).then(() => Swal.close())"
                            class="text-gray-600 hover:text-gray-800 text-2xl">
                        <i class="fas fa-link"></i>
                    </button>
                </div>
            `,
            showConfirmButton: false,
            showCloseButton: true,
            customClass: {
                container: 'share-modal'
            }
        });
    }
});