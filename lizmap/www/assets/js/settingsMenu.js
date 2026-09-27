/**
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'lizmap-theme'; // 'default' or 'dark'
    var DARK_CLASS = 'dark'; // must match :root.dark in theme.css

    function applyTheme(theme) {
        // Applied on <html>, matching where the CSS variables are
        // declared (:root in main.css).
        document.documentElement.classList.toggle(DARK_CLASS, theme === 'dark');
    }

    function saveTheme(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) {
            // Storage unavailable (private browsing, blocked cookies...):
            // the theme just won't be remembered.
        }
    }

    function loadTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'default';
        } catch (e) {
            return 'default';
        }
    }

    // Wires the Settings > Theme menu links (data-theme-choice="default"/"dark").
    function bindThemeLinks() {
        document.querySelectorAll('[data-theme-choice]').forEach(function (link) {
            if (link.dataset.themeBound === 'true') {
                return;
            }
            link.addEventListener('click', function (e) {
                e.preventDefault();
                var theme = this.getAttribute('data-theme-choice');
                applyTheme(theme);
                saveTheme(theme);
            });
            link.dataset.themeBound = 'true';
        });
    }

    // Removes "lang" from the visible URL after a language change,
    // without reloading. The ?lang=... param is still needed for the
    // server-side switch (autolocale/langpersist plugins), so it's
    // only stripped client-side, after the page has already loaded in
    // the right language, via history.replaceState (no navigation).
    function cleanLangParamFromUrl() {
        var url = new URL(window.location.href);
        if (!url.searchParams.has('lang')) {
            return;
        }
        url.searchParams.delete('lang');
        window.history.replaceState(null, '', url.toString());
    }

    // Wires the Settings > Language menu links (href="?lang=xx_XX").
    // Those links only carry "lang" in their query string, but the
    // current page URL may need other params too (repository,
    // project...); rebuild the target URL from the current one,
    // changing only "lang", instead of following the link directly.
    function bindLangLinks() {
        document.querySelectorAll('a[href*="?lang="]').forEach(function (link) {
            if (link.dataset.langBound === 'true') {
                return;
            }
            link.addEventListener('click', function (e) {
                var url = new URL(link.href, window.location.href);
                var lang = url.searchParams.get('lang');
                if (!lang) {
                    return;
                }
                e.preventDefault();
                var target = new URL(window.location.href);
                target.searchParams.set('lang', lang);
                window.location.href = target.toString();
            });
            link.dataset.langBound = 'true';
        });
    }

    function init() {
        bindThemeLinks();
        bindLangLinks();
    }

    // Applied immediately, not on DOMContentLoaded: <html> exists as
    // soon as the parser reaches it, well before the rest of the page
    // loads. Waiting would cause a visible flash of the default theme.
    applyTheme(loadTheme());
    cleanLangParamFromUrl();

    // This script loads on both portal pages (no lizMap object) and
    // the map page (lizMap exists), so lizMap.events.on(...) can't be
    // called unconditionally at the top level.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // On the map page, lizMap can rebuild its UI: re-apply the theme
    // and re-bind the links then too. No-op on pages without a map.
    if (window.lizMap && lizMap.events && typeof lizMap.events.on === 'function') {
        lizMap.events.on({
            uicreated: init
        });
    }
})();
