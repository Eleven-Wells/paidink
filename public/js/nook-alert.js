(function () {
    'use strict';

    var dismissTimer = null;
    var expandTimer = null;
    var leaveTimer = null;
    var DEFAULT_DURATION = 4000;
    var EXPAND_DELAY = 160;
    var LEAVE_DURATION = 380;

    var ICONS = {
        success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
        error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
        warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
        info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
    };

    function getAlert() {
        return document.getElementById('nook-alert');
    }

    function clearTimers() {
        if (dismissTimer) {
            clearTimeout(dismissTimer);
            dismissTimer = null;
        }
        if (expandTimer) {
            clearTimeout(expandTimer);
            expandTimer = null;
        }
        if (leaveTimer) {
            clearTimeout(leaveTimer);
            leaveTimer = null;
        }
    }

    function normalizeType(type) {
        var t = (type || 'success').toLowerCase();
        if (t === 'warn') return 'warning';
        if (ICONS[t]) return t;
        return 'info';
    }

    function hideNookAlert() {
        var el = getAlert();
        if (!el || !el.classList.contains('is-visible')) return;

        clearTimers();
        el.classList.remove('is-expanded');
        el.classList.add('is-leaving');

        leaveTimer = setTimeout(function () {
            el.classList.remove('is-visible', 'is-leaving');
            el.setAttribute('hidden', '');
        }, LEAVE_DURATION);
    }

    function showToast(message, type, duration) {
        var el = getAlert();
        if (!el) return;

        var alertType = normalizeType(type);
        var messageEl = el.querySelector('.nook-alert__message');
        var iconEl = el.querySelector('.nook-alert__icon');

        clearTimers();
        el.classList.remove('is-leaving', 'is-expanded', 'is-visible');
        el.className = 'nook-alert nook-alert--' + alertType;

        if (messageEl) messageEl.textContent = message || '';
        if (iconEl) iconEl.innerHTML = ICONS[alertType] || ICONS.info;

        el.removeAttribute('hidden');

        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                el.classList.add('is-visible');
                expandTimer = setTimeout(function () {
                    el.classList.add('is-expanded');
                }, EXPAND_DELAY);
            });
        });

        var ms = typeof duration === 'number' ? duration : DEFAULT_DURATION;
        if (ms > 0) {
            dismissTimer = setTimeout(hideNookAlert, ms);
        }
    }

    function init() {
        var el = getAlert();
        if (!el) return;

        var dismissBtn = el.querySelector('.nook-alert__dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                hideNookAlert();
            });
        }
    }

    window.showToast = showToast;
    window.hideNookAlert = hideNookAlert;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
