/**
 * @module modules/LogoFullscreen.js
 * @name LogoFullscreen
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

/**
 * The logo of the header of the map toggles full screen: a click (or Enter
 * or Space when it has the focus) puts the whole page in full screen with
 * the Fullscreen API, a second click (or Escape) leaves it. Its tooltip
 * tells which one it does.
 *
 * Nothing is done when the browser cannot go full screen (no Fullscreen
 * API, or a map embedded in an iframe without the "fullscreen" permission):
 * the logo stays as it was.
 * @param {Document} doc - The document of the map page.
 * @returns {HTMLElement|null} The logo, or null when it does nothing.
 */
export function initLogoFullscreen(doc = document) {
    const logo = doc.querySelector('#header #logo');
    const root = doc.documentElement;
    if (!logo || typeof root.requestFullscreen !== 'function' || !doc.fullscreenEnabled) {
        return null;
    }

    const text = (key, fallback) => globalThis.lizDict?.[key] || fallback;

    // Tooltip, label and state of the logo, used as a toggle button.
    const update = () => {
        const full = doc.fullscreenElement !== null;
        const label = full
            ? text('header.logo.fullscreen.exit', 'Exit full screen')
            : text('header.logo.fullscreen', 'Full screen');
        logo.title = label;
        logo.setAttribute('aria-label', label);
        logo.setAttribute('aria-pressed', String(full));
    };

    const toggle = () => {
        // A refusal of the browser (no user gesture...) is not an error
        // of the page: it stays as it is.
        const done = doc.fullscreenElement ? doc.exitFullscreen() : root.requestFullscreen();
        done?.catch?.(() => {});
    };

    logo.classList.add('lizmap-logo-fullscreen');
    logo.setAttribute('role', 'button');
    logo.tabIndex = 0;
    logo.addEventListener('click', toggle);
    logo.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
        }
    });
    doc.addEventListener('fullscreenchange', update);
    update();
    return logo;
}
