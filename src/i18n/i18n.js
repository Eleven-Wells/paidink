const i18next = require('i18next');
const sprintf = require('sprintf-js').sprintf;

const translations = {
    en: {
        translation: {
            home: 'Home',
            about: 'About',
            contact: 'Contact',
            search: 'Search',
            subscribe: 'Subscribe',
            newsletter: {
                title: 'Subscribe to Newsletter',
                placeholder: 'Enter your email',
                button: 'Subscribe',
                success: 'Successfully subscribed!',
                error: 'Subscription failed. Please try again.',
                alreadySubscribed: 'Already subscribed!'
            },
            categories: {
                title: 'Categories',
                development: 'Development',
                business: 'Business',
                health: 'Health',
                lifestyle: 'Lifestyle',
                news: 'News',
                sports: 'Sports',
                entertainment: 'Entertainment',
                politics: 'Politics'
            },
            posts: {
                readMore: 'Read More',
                relatedPosts: 'Related Articles',
                publishedOn: 'Published on',
                by: 'by'
            },
            errors: {
                notFound: 'Page not found',
                serverError: 'Internal server error',
                tryAgain: 'Please try again later.'
            },
            footer: {
                copyright: 'All rights reserved.',
                poweredBy: 'Powered by'
            },
            meta: {
                description: 'Latest tech news and updates',
                keywords: 'technology, programming, javascript, nodejs, devops'
            }
        }
    },
    es: {
        translation: {
            home: 'Inicio',
            about: 'Acerca de',
            contact: 'Contacto',
            search: 'Buscar',
            subscribe: 'Suscribirse',
            newsletter: {
                title: 'Suscribirse al Boletin',
                placeholder: 'Ingresa tu email',
                button: 'Suscribirse',
                success: 'Suscrito exitosamente!',
                error: 'Error de suscripcion. Intenta de nuevo.',
                alreadySubscribed: 'Ya estas suscrito!'
            },
            categories: {
                title: 'Categorias',
                development: 'Desarrollo',
                business: 'Negocios',
                health: 'Salud',
                lifestyle: 'Estilo de Vida',
                news: 'Noticias',
                sports: 'Deportes',
                entertainment: 'Entretenimiento',
                politics: 'Politica'
            },
            posts: {
                readMore: 'Leer Mas',
                relatedPosts: 'Articulos Relacionados',
                publishedOn: 'Publicado el',
                by: 'por'
            },
            errors: {
                notFound: 'Pagina no encontrada',
                serverError: 'Error interno del servidor',
                tryAgain: 'Por favor intenta mas tarde.'
            },
            footer: {
                copyright: 'Todos los derechos reservados.',
                poweredBy: 'Desarrollado con'
            },
            meta: {
                description: 'Ultimas noticias y actualizaciones de tecnologia',
                keywords: 'tecnologia, programacion, javascript, nodejs, devops'
            }
        }
    }
};

const supportedLanguages = ['en', 'es'];
const defaultLanguage = 'en';

async function initI18n() {
    await i18next.init({
        lng: defaultLanguage,
        fallbackLng: defaultLanguage,
        resources: translations,
        interpolation: {
            escapeValue: false
        }
    });
}

function t(key, options = {}) {
    return i18next.t(key, options);
}

function changeLanguage(lng) {
    if (supportedLanguages.includes(lng)) {
        i18next.changeLanguage(lng);
        return true;
    }
    return false;
}

function getLanguage(request) {
    const queryLang = request.query?.lang;
    if (queryLang && supportedLanguages.includes(queryLang)) {
        return queryLang;
    }

    const headerLang = request.headers?.['accept-language']?.split(',')[0]?.split('-')[0];
    if (headerLang && supportedLanguages.includes(headerLang)) {
        return headerLang;
    }

    return defaultLanguage;
}

function createTranslateFunction(request) {
    const lng = getLanguage(request);
    i18next.changeLanguage(lng);

    return function translate(key, options = {}) {
        return i18next.t(key, options);
    };
}

function formatDate(date, locale = 'en') {
    const d = new Date(date);
    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };

    const localeMap = {
        en: 'en-US',
        es: 'es-ES'
    };

    return d.toLocaleDateString(localeMap[locale] || localeMap.en, options);
}

function formatRelativeTime(date, locale = 'en') {
    const now = new Date();
    const d = new Date(date);
    const diff = now - d;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const translations = {
        en: {
            now: 'just now',
            minute: '{count} minute ago',
            minutes: '{count} minutes ago',
            hour: '{count} hour ago',
            hours: '{count} hours ago',
            day: '{count} day ago',
            days: '{count} days ago'
        },
        es: {
            now: 'ahora mismo',
            minute: 'hace {count} minuto',
            minutes: 'hace {count} minutos',
            hour: 'hace {count} hora',
            hours: 'hace {count} horas',
            day: 'hace {count} dia',
            days: 'hace {count} dias'
        }
    };

    const t = translations[locale] || translations.en;

    if (seconds < 60) return t.now;
    if (minutes < 60) {
        const key = minutes === 1 ? 'minute' : 'minutes';
        return sprintf(t[key], minutes);
    }
    if (hours < 24) {
        const key = hours === 1 ? 'hour' : 'hours';
        return sprintf(t[key], hours);
    }
    const key = days === 1 ? 'day' : 'days';
    return sprintf(t[key], days);
}

initI18n();

module.exports = {
    t,
    changeLanguage,
    getLanguage,
    createTranslateFunction,
    formatDate,
    formatRelativeTime,
    supportedLanguages,
    defaultLanguage,
    i18next
};
