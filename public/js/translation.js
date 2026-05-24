// Initialize i18next
async function initializeTranslations() {
    const userLang = navigator.language.split('-')[0] || 'en';

    await i18next.init({
        lng: userLang,
        fallbackLng: 'en',
        resources: {
            en: {
                translation: {
                    home: 'Home',
                    ai: 'AI',
                    tech_news: 'Tech News',
                    github: 'GitHub',
                    search_placeholder: 'Search articles...',
                    next_page: 'Next',
                    previous_page: 'Previous',
                    no_results: 'No results found'
                }
            },
            es: {
                translation: {
                    home: 'Inicio',
                    ai: 'IA',
                    tech_news: 'Noticias Tech',
                    github: 'GitHub',
                    search_placeholder: 'Buscar artículos...',
                    next_page: 'Siguiente',
                    previous_page: 'Anterior',
                    no_results: 'No se encontraron resultados'
                }
            }
            // Add more languages as needed
        }
    });

    // Update all text content
    updatePageTranslations();
}

function updatePageTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        element.textContent = i18next.t(key);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const languageSelector = document.getElementById('language-selector');

    // Set initial language based on user's preference
    const userLang = navigator.language.split('-')[0] || 'en';
    languageSelector.value = userLang;

    // Initialize translations
    initializeTranslations();

    // Handle language changes
    languageSelector.addEventListener('change', async (e) => {
        await i18next.changeLanguage(e.target.value);
        document.documentElement.lang = e.target.value;
        updatePageTranslations();

        // Reload content with new language
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('lang', e.target.value);
        window.location.href = currentUrl.toString();
    });
});