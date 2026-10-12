/**
 * @module modules/PanelWindows.js
 * @name PanelWindows
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { windowsArea } from './WindowsArea.js';

/**
 * Lizmap panels shown in dockable windows (<lizmap-dock-window>), like the
 * measure tools: moved by their title bar, resized by their edges and
 * corners, docked to the left, right or bottom edge of the map, maximized.
 *
 * Each panel element is moved as is into its window (same id, classes and
 * content), so the existing code and style sheets still find it. Opening
 * a panel in a separate browser window is not offered: the legacy tools
 * look for their elements in the page of the map.
 *
 * Each window opens at its default place (the usual place of the panel).
 * Once the user moves, resizes, docks or maximizes it, it keeps that place
 * until the page is reloaded; nothing is saved in the browser.
 *
 * Entries:
 * - `element`: id of the Lizmap panel;
 * - `menuItems`, `openEvent`, `closeEvent`: items of the left menu which
 *   open the tools of the panel (class `active` on the open one) and the
 *   Lizmap events sent when they open or close;
 * - or `observe: true`: the panel is shown and hidden by the legacy code
 *   (inline `display`), with `closeButton` (selector of its own close
 *   button) and `headingSelector` (its title);
 * - `place`: default place, docked (`dock`: 'left', 'right' or 'bottom'
 *   with its size) or floating, as high as the content (`fit`);
 * - `sizeEvent`: Lizmap event sent after each change of the window size
 *   (the attribute table adapts its height to it).
 * @type {object[]}
 */
const PANELS = [
    {
        name: 'dock',
        element: 'dock',
        menuItems: '#mapmenu li.nav-dock',
        openEvent: 'dockopened',
        closeEvent: 'dockclosed',
        place: { dock: 'left', naturalWidth: true, min: 280, maxRatio: 0.4 },
    },
    {
        name: 'right-dock',
        element: 'right-dock',
        menuItems: '#mapmenu li.nav-right-dock',
        openEvent: 'rightdockopened',
        closeEvent: 'rightdockclosed',
        place: { dock: 'right', ratio: 0.3, min: 280 },
    },
    {
        name: 'bottom-dock',
        element: 'bottom-dock',
        menuItems: '#mapmenu li.nav-bottomdock',
        openEvent: 'bottomdockopened',
        closeEvent: 'bottomdockclosed',
        place: { dock: 'bottom', ratio: 0.48, min: 180 },
        sizeEvent: 'bottomdocksizechanged',
    },
    {
        name: 'sub-dock',
        element: 'sub-dock',
        observe: true,
        closeButton: '#hide-sub-dock',
        headingSelector: '.sub-metadata h3 .text',
        place: { fit: true, width: 300, top: 10, nextTo: 'dock', minHeight: 160, maxHeightRatio: 0.8 },
    },
    {
        name: 'mini-dock',
        element: 'mini-dock',
        menuItems: '#mapmenu li.nav-minidock',
        openEvent: 'minidockopened',
        closeEvent: 'minidockclosed',
        place: { fit: true, width: 380, top: 10, right: 60, minHeight: 160, maxHeightRatio: 0.8 },
    },
];


/**
 * A Lizmap panel in a dockable window.
 */
class PanelWindow {
    /**
     * Panel described by an entry of PANELS.
     * @param {object} config Entry of PANELS.
     * @param {object} lizMap Global lizMap object.
     * @param {Map<string, PanelWindow>} windows Windows by name (for `nextTo`).
     */
    constructor(config, lizMap, windows) {
        this.config = config;
        this.lizMap = lizMap;
        this.windows = windows;

        /**
         * True once the user moved, resized, docked or maximized the
         * window: until the page is reloaded, it keeps that place.
         * @type {boolean}
         */
        this.userPlaced = false;
    }

    /**
     * Moves the panel into a new window. Does nothing if the panel or the
     * container is missing.
     * @returns {boolean} true if the window was created
     */
    attach() {
        const panel = document.getElementById(this.config.element);
        const container = windowsArea();

        if (!panel || !container) {
            return false;
        }

        // Width the panel had at its usual place (default docked width).
        this.naturalWidth = panel.getBoundingClientRect().width;

        const dict = globalThis.lizDict || {};
        const win = document.createElement('lizmap-dock-window');

        win.classList.add('lizmap-panel-window');
        win.dataset.panel = this.config.name;
        win.setAttribute('no-popout', '');
        win.setAttribute('close-label', dict['dockwindow.close'] || 'Close');
        win.setAttribute('maximize-label', dict['dockwindow.maximize'] || 'Maximize');
        win.setAttribute('restore-label', dict['dockwindow.restore'] || 'Restore');
        win.hidden = true;

        container.appendChild(win);
        win.body.appendChild(panel);

        this.win = win;
        this.panel = panel;

        // Any move, resize, dock or maximize done by the user starts with a
        // pointer press on the window frame (title bar, buttons, edges),
        // not on its content.
        win.addEventListener('pointerdown', (evt) => {
            if (!this.panel.contains(evt.target)) {
                this.userPlaced = true;
            }
        }, true);

        // Close button: same as the usual way of closing the panel.
        win.addEventListener('dockwindowclose', () => this.close());

        if (this.config.sizeEvent) {
            let pending = false;

            win.addEventListener('dockwindowlayout', () => {
                if (win.hidden || pending) {
                    return;
                }

                pending = true;

                requestAnimationFrame(() => {
                    pending = false;
                    this.lizMap.events.triggerEvent(this.config.sizeEvent, { size: 'unknown' });
                });
            });
        }

        if (this.config.observe) {
            new MutationObserver(() => this.update())
                .observe(panel, { attributes: true, attributeFilter: ['style'], childList: true });
        } else {
            const events = {};

            events[this.config.openEvent] = () => this.update();
            // The menu item loses its "active" class just around the event:
            // look once the click is handled.
            events[this.config.closeEvent] = () => setTimeout(() => this.update(), 0);

            this.lizMap.events.on(events);
        }

        this.update();

        return true;
    }

    /**
     * Open menu item of the panel, or null.
     * @returns {HTMLElement|null} Link of the item.
     */
    activeItem() {
        return this.config.menuItems
            ? document.querySelector(`${this.config.menuItems}.active > a`)
            : null;
    }

    /**
     * Whether the panel has something to show.
     * @returns {boolean} true if open
     */
    isOpen() {
        if (this.config.observe) {
            const display = this.panel.style.display;

            return display !== '' && display !== 'none' && this.panel.childElementCount > 0;
        }

        return this.activeItem() !== null;
    }

    /**
     * Title of the window: the open tool, or the title of the panel.
     * @returns {string} Title
     */
    title() {
        if (this.config.headingSelector) {
            return this.panel.querySelector(this.config.headingSelector)?.textContent.trim() || '';
        }

        const active = this.activeItem();

        return (active?.dataset.originalTitle
            || active?.getAttribute('title')
            || active?.querySelector('.menu-title')?.textContent
            || '').trim();
    }

    /**
     * Closes the panel the usual way (which hides the window).
     */
    close() {
        if (this.config.closeButton) {
            this.panel.querySelector(this.config.closeButton)?.click();
        } else {
            this.activeItem()?.click();
        }
    }

    /**
     * Shows the window when the panel is open, hides it otherwise.
     */
    update() {
        if (!this.isOpen()) {
            this.win.hidden = true;

            return;
        }

        this.win.heading = this.title();

        const wasHidden = this.win.hidden;

        this.win.hidden = false;

        if (!this.userPlaced && (wasHidden || this.config.place.fit)) {
            this.placeByDefault();
        }

        if (wasHidden && this.config.sizeEvent) {
            this.lizMap.events.triggerEvent(this.config.sizeEvent, { size: 'unknown' });
        }
    }

    /**
     * Default place: docked as the panel usually is, or floating as high
     * as its content.
     */
    placeByDefault() {
        const place = this.config.place;
        const container = this.win.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        if (place.dock) {
            let size;

            if (place.dock === 'bottom') {
                size = Math.max(place.min, height * place.ratio);
            } else if (place.naturalWidth && this.naturalWidth > 0) {
                size = Math.max(place.min, Math.min(this.naturalWidth, width * place.maxRatio));
            } else {
                size = Math.max(place.min, width * (place.ratio || place.maxRatio));
            }

            size = Math.round(size);

            // Floating place used if the window is undocked.
            this.win.open({ width: 360, height: Math.round(height * 0.6), top: 10, right: 60 });
            this.win.layout = { state: place.dock, lastDockSide: place.dock, dockSize: { [place.dock]: size } };

            return;
        }

        const header = this.win.querySelector('.dock-window-header');
        const bodyStyle = getComputedStyle(this.win.body);
        const padding = parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom);
        // Height of the content itself: the panel fills the window, so its
        // own height is the one of the window, not of its content.
        const content = Array.from(this.panel.children)
            .reduce((total, child) => total + child.offsetHeight, 0);
        const wanted = (header ? header.offsetHeight : 0) + padding + content + 2;
        const winHeight = Math.round(Math.max(place.minHeight, Math.min(wanted, height * place.maxHeightRatio)));

        // Next to a window docked on the left (layer information next to
        // the layer tree), else at the given place.
        const neighbour = place.nextTo ? this.windows.get(place.nextTo)?.win : null;

        if (neighbour && !neighbour.hidden && neighbour.dataset.dock === 'left') {
            this.win.open({ width: place.width, height: winHeight, top: place.top, left: neighbour.offsetWidth + 8 });
        } else if (place.right !== undefined) {
            this.win.open({ width: place.width, height: winHeight, top: place.top, right: place.right });
        } else {
            this.win.open({ width: place.width, height: winHeight, top: place.top, left: 10 });
        }
    }
}

/**
 * Puts the Lizmap panels of PANELS in dockable windows. Not on small
 * screens (mobile layout) nor in embedded maps, where the panels keep
 * their place.
 * @param {object} lizMap Global lizMap object.
 * @returns {PanelWindow[]} The windows created.
 */
export function initPanelWindows(lizMap) {
    const content = document.getElementById('content');

    if (content?.classList.contains('mobile') || content?.classList.contains('embed')) {
        return [];
    }

    const windows = new Map();

    PANELS.forEach((config) => {
        const panelWindow = new PanelWindow(config, lizMap, windows);

        if (panelWindow.attach()) {
            windows.set(config.name, panelWindow);
        }
    });

    return [...windows.values()];
}

export { PANELS };
