/**
 * @module components/DockWindow.js
 * @name DockWindow
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { isTypingTarget, MEASURE_KEYS } from '../modules/measures/Keyboard.js';

/**
 * Distance (px) between an edge of the window and the same edge of the
 * container under which the window "touches" that edge: dropping it there
 * docks it to that edge. The window can't leave the container, so an edge
 * reaches exactly 0 when pushed against it.
 * @type {number}
 */
const DOCK_SNAP_DISTANCE = 6;

/**
 * Minimum size (px) of the window, floating or docked.
 * @type {number}
 */
const MIN_WIDTH = 220;

/** @type {number} */
const MIN_HEIGHT = 120;

/**
 * Space (px) always left free next to a docked window, so it can never
 * cover the whole container.
 * @type {number}
 */
const DOCK_MARGIN = 40;

/**
 * Resize handles: n, s, e, w and the four corners.
 * @type {string[]}
 */
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/**
 * Icons of the title bar buttons: SVG files of lizmap/www/assets/icons/
 * (window-*.svg), painted in the colour of the button by the .svg-icon
 * CSS mask (map.css).
 * @type {{[key: string]: string}}
 */
const ICONS = {
    maximize: '<span class="svg-icon svg-window-maximize" aria-hidden="true"></span>',
    restore: '<span class="svg-icon svg-window-restore" aria-hidden="true"></span>',
    popout: '<span class="svg-icon svg-window-popout" aria-hidden="true"></span>',
    popin: '<span class="svg-icon svg-window-popin" aria-hidden="true"></span>',
    close: '<span class="svg-icon svg-window-close" aria-hidden="true"></span>',
};

/** Counter giving each window its own browser window name when detached. */
let popoutCounter = 0;

/**
 * Generic window which can float over its container (moved by its title
 * bar, resized by its edges and corners) or be docked to the left, right
 * or bottom edge of the container, like the panels of QGIS Desktop.
 *
 * - Drag the title bar until an edge of the window touches the same edge
 *   of the container: a preview shows where the window will dock; release
 *   to dock it.
 * - Drag the title bar of a docked window: it floats again.
 * - Double-click the title bar: docks a floating window (to the last
 *   used side, right by default) or floats a docked one.
 * - "Maximize" button: the window fills the whole container; the same
 *   button (now "Restore") gives it back its previous place.
 * - "New window" button: the content moves to a separate browser window
 *   (e.g. on a second screen). Its "Back to the map" button brings it
 *   back; closing that browser window closes the window for good (event
 *   `dockwindowclose`, as with the close button).
 *
 * The window is positioned inside its parent element (which must be
 * positioned, e.g. #map-content). Its content goes into `body`.
 *
 * Attributes: `close-label`, `maximize-label`, `restore-label`,
 * `popout-label` and `popin-label` (tooltips of the buttons).
 * Events: `dockwindowclose` (close button), `dockwindowlayout` (after
 * each move, resize, dock, float or maximize), `dockwindowpopout` and
 * `dockwindowpopin` (content moved to a separate browser window, and back).
 * @example
 * const win = document.createElement('lizmap-dock-window');
 * win.heading = 'Elevation profile';
 * document.getElementById('map-content').appendChild(win);
 * win.open({ width: 450, height: 280, top: 10, right: 60 });
 * win.body.appendChild(content);
 * @class
 * @name DockWindow
 * @augments HTMLElement
 */
export default class DockWindow extends HTMLElement {
    constructor() {
        super();

        /**
         * 'floating', 'left', 'right', 'bottom', 'maximized' or 'popout'.
         * @type {string}
         */
        this._state = 'floating';

        /**
         * State to go back to after 'maximized' or 'popout'.
         * @type {string}
         */
        this._restoreState = 'floating';

        /**
         * Separate browser window holding the content, or null.
         * @type {object|null}
         */
        this._popoutWindow = null;
        this._popoutTimer = null;

        // The separate browser window is closed by the user: the window is
        // closed for good. The page itself is left: the separate window is
        // closed with it.
        this._onPopupClosed = () => this._popupClosedByUser();
        this._onMainPageHide = () => this._closePopoutWindow();

        // Keyboard shortcuts of the tools (Escape, Backspace, Delete) typed
        // in the separate window: passed on to the page of the map, where
        // the tools listen to them.
        this._onPopupKeyDown = (event) => {
            if (!MEASURE_KEYS.has(event.key) || isTypingTarget(event.target)) {
                return;
            }

            event.preventDefault();

            document.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, bubbles: true, cancelable: true }));
        };

        /**
         * Position and size of the floating window, in px relative to the
         * container. Kept while docked, to float back at the same place.
         * @type {{left: number, top: number, width: number, height: number}|null}
         */
        this._floatRect = null;

        /**
         * Width (left/right) or height (bottom) of the docked window.
         * @type {{left: number, right: number, bottom: number}}
         */
        this._dockSize = { left: 450, right: 450, bottom: 280 };

        /** @type {string} */
        this._lastDockSide = 'right';

        /** @type {object|null} */
        this._drag = null;

        this._onWindowResize = () => this._applyLayout();
    }

    connectedCallback() {
        if (!this._built) {
            this._build();
        }

        window.addEventListener('resize', this._onWindowResize);

        this._applyLayout();
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this._onWindowResize);

        this._preview?.remove();

        // The window is closed: its separate browser window too.
        this._closePopoutWindow();
    }

    /**
     * Element receiving the content of the window.
     * @type {HTMLElement}
     */
    get body() {
        if (!this._built) {
            this._build();
        }

        return this._body;
    }

    /**
     * Current state: 'floating', 'left', 'right', 'bottom', 'maximized' or
     * 'popout'.
     * @type {string}
     */
    get dockState() {
        return this._state;
    }

    /**
     * Title shown in the title bar.
     * @type {string}
     */
    set heading(text) {
        if (!this._built) {
            this._build();
        }

        this._title.textContent = text;

        // Also in the separate browser window, if the content is there.
        const popup = this._popoutWindow;

        if (popup && !popup.closed) {
            popup.document.title = text;

            const barTitle = popup.document.querySelector('.dock-window-popout-title');

            if (barTitle) {
                barTitle.textContent = text;
            }
        }
    }

    get heading() {
        return this._title ? this._title.textContent : '';
    }

    /**
     * Shows the window floating, at the given size and position (in px,
     * relative to the container; `right` is used when `left` is not set).
     * @param {object} [options] Size and position.
     * @param {number} [options.width] Width.
     * @param {number} [options.height] Height.
     * @param {number} [options.top] Distance from the top of the container.
     * @param {number} [options.left] Distance from the left of the container.
     * @param {number} [options.right] Distance from the right of the container.
     */
    open({ width = 450, height = 280, top = 10, left, right = 60 } = {}) {
        const containerWidth = this.parentElement ? this.parentElement.clientWidth : width;

        this._floatRect = {
            left: left !== undefined ? left : containerWidth - width - right,
            top,
            width,
            height,
        };

        this._state = 'floating';

        this._applyLayout();
    }

    /**
     * Docks the window to an edge of the container.
     * @param {string} side 'left', 'right' or 'bottom'.
     */
    dock(side) {
        if (!['left', 'right', 'bottom'].includes(side)) {
            return;
        }

        this._state = side;

        this._lastDockSide = side;

        this._applyLayout();
    }

    /**
     * Floats a docked window again, at its last floating position.
     */
    float() {
        this._state = 'floating';

        this._applyLayout();
    }

    /**
     * The window fills the whole container.
     */
    maximize() {
        if (this._state === 'maximized' || this._state === 'popout') {
            return;
        }

        this._restoreState = this._state;
        this._state = 'maximized';

        this._applyLayout();
    }

    /**
     * Gives a maximized window back its previous place (floating or
     * docked).
     */
    restore() {
        if (this._state !== 'maximized') {
            return;
        }

        this._state = this._restoreState;

        this._applyLayout();
    }

    /**
     * Moves the content of the window to a separate browser window, with
     * the style sheets of the page. The window comes back (with its
     * content) when that browser window is closed.
     * @returns {boolean} false if the browser blocked the new window
     */
    popOut() {
        if (this._state === 'popout') {
            this._popoutWindow?.focus();

            return true;
        }

        const rect = this.getBoundingClientRect();
        const width = Math.max(500, Math.round(rect.width));
        const height = Math.max(300, Math.round(rect.height));

        popoutCounter++;

        const popup = window.open('', `lizmap-dock-window-${popoutCounter}`, `popup=yes,width=${width},height=${height}`);

        if (!popup) {
            console.warn('DockWindow: the browser blocked the new window');

            return false;
        }

        const doc = popup.document;

        doc.open();
        doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
        doc.close();

        doc.title = this.heading;

        // Same theme and language as the page (attributes of <html> and
        // classes of <body>).
        for (const { name, value } of document.documentElement.attributes) {
            doc.documentElement.setAttribute(name, value);
        }

        doc.body.className = document.body.className;

        // Same style sheets, with absolute addresses.
        document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
            if (node.tagName === 'LINK') {
                const link = doc.createElement('link');

                link.rel = 'stylesheet';
                link.href = node.href;
                doc.head.appendChild(link);
            } else {
                const style = doc.createElement('style');

                style.textContent = node.textContent;
                doc.head.appendChild(style);
            }
        });

        doc.body.classList.add('dock-window-popout');

        // Bar of the separate window: title and "Back to the map" button.
        const bar = doc.createElement('div');

        bar.className = 'dock-window-popout-bar';

        const barTitle = doc.createElement('span');

        barTitle.className = 'dock-window-popout-title';
        barTitle.textContent = this.heading;

        const popInButton = doc.createElement('button');

        popInButton.type = 'button';
        popInButton.className = 'dock-window-button dock-window-popin-button';
        popInButton.innerHTML = ICONS.popin;
        popInButton.title = this.getAttribute('popin-label') || 'Back to the map';
        popInButton.addEventListener('click', () => this.popIn());

        bar.append(barTitle, popInButton);

        const container = doc.createElement('div');

        container.className = 'dock-window-popout-body';

        doc.body.append(bar, container);

        this._restoreState = this._state === 'maximized' ? this._restoreState : this._state;
        this._state = 'popout';
        this._popoutWindow = popup;

        // The content moves to the new window.
        while (this._body.firstChild) {
            container.appendChild(this._body.firstChild);
        }

        this._applyLayout();

        // Closed for good when the user closes the new window (pagehide).
        // "closed" is also watched: pagehide is not always fired when the
        // browser closes the window.
        popup.addEventListener('pagehide', this._onPopupClosed);
        popup.document.addEventListener('keydown', this._onPopupKeyDown);
        window.addEventListener('pagehide', this._onMainPageHide);

        this._popoutTimer = setInterval(() => {
            if (popup.closed) {
                this._popupClosedByUser();
            }
        }, 500);

        this.dispatchEvent(new CustomEvent('dockwindowpopout', { detail: { window: popup } }));

        return true;
    }

    /**
     * Brings the content back from the separate browser window, and closes
     * it.
     */
    popIn() {
        if (this._state !== 'popout') {
            return;
        }

        const popup = this._popoutWindow;
        const container = popup && !popup.closed ? popup.document.querySelector('.dock-window-popout-body') : null;

        this._state = this._restoreState === 'popout' ? 'floating' : this._restoreState;

        this._applyLayout();

        if (container) {
            while (container.firstChild) {
                this._body.appendChild(container.firstChild);
            }
        }

        this._closePopoutWindow();

        this.dispatchEvent(new CustomEvent('dockwindowpopin'));
    }

    /**
     * The user closed the separate browser window: its content is taken back
     * (so that it is removed properly, with the window) and the window is
     * closed for good, as with its close button.
     */
    _popupClosedByUser() {
        if (this._state !== 'popout') {
            return;
        }

        const popup = this._popoutWindow;

        try {
            const container = popup?.document?.querySelector('.dock-window-popout-body');

            while (container?.firstChild) {
                this._body.appendChild(container.firstChild);
            }
        } catch (error) {
            // Window already destroyed: its content is lost with it.
            console.warn('DockWindow: content of the closed window not recovered', error);
        }

        this._state = this._restoreState === 'popout' ? 'floating' : this._restoreState;

        this._closePopoutWindow();

        this._applyLayout();

        this.dispatchEvent(new CustomEvent('dockwindowclose'));
    }

    _closePopoutWindow() {
        if (this._popoutTimer) {
            clearInterval(this._popoutTimer);
            this._popoutTimer = null;
        }

        window.removeEventListener('pagehide', this._onMainPageHide);

        const popup = this._popoutWindow;

        this._popoutWindow = null;

        if (popup) {
            try {
                popup.removeEventListener('pagehide', this._onPopupClosed);
                popup.document.removeEventListener('keydown', this._onPopupKeyDown);
            } catch {
                // Window already destroyed.
            }

            if (!popup.closed) {
                popup.close();
            }
        }
    }

    // =====================================================
    // DOM
    // =====================================================

    _build() {
        this._built = true;

        this.classList.add('lizmap-dock-window');

        this._header = document.createElement('div');
        this._header.className = 'dock-window-header';

        this._title = document.createElement('span');
        this._title.className = 'dock-window-title';

        this._popoutButton = this._createButton('dock-window-popout-button', ICONS.popout);
        this._maximizeButton = this._createButton('dock-window-maximize', ICONS.maximize);

        this._closeButton = document.createElement('button');
        this._closeButton.type = 'button';
        this._closeButton.className = 'dock-window-close';
        this._closeButton.innerHTML = ICONS.close;
        this._closeButton.title = this.getAttribute('close-label') || 'Close';
        this._closeButton.setAttribute('aria-label', this._closeButton.title);

        this._header.append(this._title, this._popoutButton, this._maximizeButton, this._closeButton);

        this._updateButtons();

        this._body = document.createElement('div');
        this._body.className = 'dock-window-body';

        this.append(this._header, this._body);

        HANDLES.forEach((dir) => {
            const handle = document.createElement('div');

            handle.className = `dock-window-handle dock-window-handle-${dir}`;

            handle.addEventListener('pointerdown', (evt) => this._startResize(evt, dir));

            this.appendChild(handle);
        });

        this._header.addEventListener('pointerdown', (evt) => this._startMove(evt));

        this._header.addEventListener('dblclick', (evt) => {
            if (evt.target.closest('button')) {
                return;
            }

            if (this._state === 'maximized') {
                this.restore();
            } else if (this._state === 'floating') {
                this.dock(this._lastDockSide);
            } else {
                this.float();
            }
        });

        this._closeButton.addEventListener('pointerdown', (evt) => evt.stopPropagation());

        this._closeButton.addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('dockwindowclose'));
        });

        this._maximizeButton.addEventListener('click', () => {
            if (this._state === 'maximized') {
                this.restore();
            } else {
                this.maximize();
            }
        });

        this._popoutButton.addEventListener('click', () => this.popOut());
    }

    /**
     * Creates a button of the title bar.
     * @param {string} className Class.
     * @param {string} icon Icon (markup of ICONS).
     * @returns {HTMLElement} Button.
     */
    _createButton(className, icon) {
        const button = document.createElement('button');

        button.type = 'button';
        button.className = `dock-window-button ${className}`;
        button.innerHTML = icon;

        // A click on a button doesn't start moving the window.
        button.addEventListener('pointerdown', (evt) => evt.stopPropagation());

        return button;
    }

    // Icon and tooltip of the maximize button follow the state.
    _updateButtons() {
        if (!this._maximizeButton) {
            return;
        }

        const maximized = this._state === 'maximized';

        this._maximizeButton.innerHTML = maximized ? ICONS.restore : ICONS.maximize;
        this._maximizeButton.title = maximized
            ? this.getAttribute('restore-label') || 'Restore'
            : this.getAttribute('maximize-label') || 'Maximize';
        this._popoutButton.title = this.getAttribute('popout-label') || 'Open in a new window';
    }

    static get observedAttributes() {
        return ['close-label', 'maximize-label', 'restore-label', 'popout-label', 'popin-label'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'close-label' && this._closeButton) {
            this._closeButton.title = newValue || 'Close';
        } else {
            this._updateButtons();
        }
    }

    // =====================================================
    // LAYOUT
    // =====================================================

    /**
     * Keeps a floating rectangle inside the container.
     * @param {{left: number, top: number, width: number, height: number}} rect Rectangle.
     * @param {number} containerWidth Container width.
     * @param {number} containerHeight Container height.
     * @returns {{left: number, top: number, width: number, height: number}} Clamped rectangle.
     */
    _clampRect(rect, containerWidth, containerHeight) {
        const width = Math.max(MIN_WIDTH, Math.min(rect.width, containerWidth));
        const height = Math.max(MIN_HEIGHT, Math.min(rect.height, containerHeight));

        return {
            width,
            height,
            left: Math.max(0, Math.min(rect.left, containerWidth - width)),
            top: Math.max(0, Math.min(rect.top, containerHeight - height)),
        };
    }

    /**
     * Keeps a docked size between the minimum and the container size
     * (minus DOCK_MARGIN).
     * @param {number} size Size.
     * @param {number} min Minimum.
     * @param {number} containerSize Container width or height.
     * @returns {number} Clamped size.
     */
    _clampDockSize(size, min, containerSize) {
        return Math.max(min, Math.min(size, containerSize - DOCK_MARGIN));
    }

    _applyLayout() {
        const container = this.parentElement;

        if (!container || !this._built) {
            return;
        }

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        this.dataset.dock = this._state;

        this._updateButtons();

        const style = this.style;

        if (this._state === 'maximized' || this._state === 'popout') {
            // Popout: the window is hidden by the style sheet.
            Object.assign(style, {
                left: '0px',
                right: '0px',
                top: '0px',
                bottom: '0px',
                width: 'auto',
                height: 'auto',
            });
        } else if (this._state === 'floating') {
            if (!this._floatRect) {
                this._floatRect = { left: containerWidth - 450 - 60, top: 10, width: 450, height: 280 };
            }

            this._floatRect = this._clampRect(this._floatRect, containerWidth, containerHeight);

            Object.assign(style, {
                left: `${this._floatRect.left}px`,
                top: `${this._floatRect.top}px`,
                width: `${this._floatRect.width}px`,
                height: `${this._floatRect.height}px`,
                right: 'auto',
                bottom: 'auto',
            });
        } else if (this._state === 'left' || this._state === 'right') {
            const width = this._clampDockSize(this._dockSize[this._state], MIN_WIDTH, containerWidth);

            this._dockSize[this._state] = width;

            Object.assign(style, {
                left: this._state === 'left' ? '0px' : 'auto',
                right: this._state === 'right' ? '0px' : 'auto',
                top: '0px',
                bottom: '0px',
                width: `${width}px`,
                height: 'auto',
            });
        } else {
            const height = this._clampDockSize(this._dockSize.bottom, MIN_HEIGHT, containerHeight);

            this._dockSize.bottom = height;

            Object.assign(style, {
                left: '0px',
                right: '0px',
                top: 'auto',
                bottom: '0px',
                width: 'auto',
                height: `${height}px`,
            });
        }

        this.dispatchEvent(new CustomEvent('dockwindowlayout'));
    }

    // =====================================================
    // MOVE (title bar) AND DOCKING
    // =====================================================

    /**
     * Side where the floating window would dock: the edge of the container
     * that one of its edges touches. In a corner (two edges touched), the
     * edge closest to the pointer wins.
     * @param {{left: number, top: number, width: number, height: number}} rect Floating window, in px relative to the container.
     * @param {number} x Pointer x, relative to the container.
     * @param {number} y Pointer y, relative to the container.
     * @param {number} width Container width.
     * @param {number} height Container height.
     * @returns {string|null} 'left', 'right', 'bottom' or null.
     */
    _dockSideAt(rect, x, y, width, height) {
        const touched = [];

        if (rect.left <= DOCK_SNAP_DISTANCE) {
            touched.push(['left', x]);
        }

        if (rect.left + rect.width >= width - DOCK_SNAP_DISTANCE) {
            touched.push(['right', width - x]);
        }

        if (rect.top + rect.height >= height - DOCK_SNAP_DISTANCE) {
            touched.push(['bottom', height - y]);
        }

        if (touched.length === 0) {
            return null;
        }

        touched.sort((a, b) => a[1] - b[1]);

        return touched[0][0];
    }

    /**
     * Shows (or hides, with null) the preview of the docked window.
     * @param {string|null} side Side.
     */
    _showDockPreview(side) {
        const container = this.parentElement;

        if (!side) {
            this._preview?.remove();

            return;
        }

        if (!this._preview) {
            this._preview = document.createElement('div');
            this._preview.className = 'dock-window-preview';
        }

        if (this._preview.parentElement !== container) {
            container.appendChild(this._preview);
        }

        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;

        const size =
            side === 'bottom'
                ? this._clampDockSize(this._dockSize.bottom, MIN_HEIGHT, containerHeight)
                : this._clampDockSize(this._dockSize[side], MIN_WIDTH, containerWidth);

        Object.assign(this._preview.style, {
            left: side === 'right' ? `${containerWidth - size}px` : '0px',
            top: side === 'bottom' ? `${containerHeight - size}px` : '0px',
            width: side === 'bottom' ? `${containerWidth}px` : `${size}px`,
            height: side === 'bottom' ? `${size}px` : `${containerHeight}px`,
        });
    }

    _startMove(evt) {
        if (evt.button !== 0) {
            return;
        }

        evt.preventDefault();

        // Nothing moves before the pointer has travelled a few pixels: a
        // simple click (or a double-click) on the title bar of a docked
        // window must not undock it.
        this._drag = {
            startX: evt.clientX,
            startY: evt.clientY,
            started: false,
            offsetX: 0,
            offsetY: 0,
            side: null,
        };

        this._trackPointer(this._header, evt, (moveEvt) => this._onMove(moveEvt), () => this._endMove());
    }

    /**
     * First real move of a drag: a docked window floats again, with its
     * last floating size, under the cursor.
     * @param {Event} evt The pointermove event.
     */
    _beginMove(evt) {
        const containerRect = this.parentElement.getBoundingClientRect();

        // Point of the window under the pointer when the drag started: a
        // floating window keeps it under the pointer (measured from the
        // pointerdown position, not from this first move, which comes a
        // few pixels further).
        let grabPoint = null;

        if (this._state !== 'floating') {
            const ownRect = this.getBoundingClientRect();
            const width = this._floatRect ? this._floatRect.width : 450;
            const height = this._floatRect ? this._floatRect.height : 280;
            const grabX = Math.min(this._drag.startX - ownRect.left, width - 40);

            this._floatRect = {
                left: evt.clientX - containerRect.left - grabX,
                top: evt.clientY - containerRect.top - 12,
                width,
                height,
            };

            this._state = 'floating';

            this._applyLayout();
        } else {
            const ownRect = this.getBoundingClientRect();

            grabPoint = { x: this._drag.startX - ownRect.left, y: this._drag.startY - ownRect.top };
        }

        const rect = this.getBoundingClientRect();

        this._drag.started = true;
        this._drag.offsetX = grabPoint ? grabPoint.x : evt.clientX - rect.left;
        this._drag.offsetY = grabPoint ? grabPoint.y : evt.clientY - rect.top;

        // A window just undocked still touches the edge it was docked to:
        // docking only becomes possible once it has left every edge, so
        // that it doesn't dock again right away.
        this._drag.armed = false;

        this.classList.add('dock-window-moving');
    }

    _onMove(evt) {
        if (!this._drag.started) {
            if (Math.hypot(evt.clientX - this._drag.startX, evt.clientY - this._drag.startY) < 5) {
                return;
            }

            this._beginMove(evt);
        }

        const container = this.parentElement;
        const containerRect = container.getBoundingClientRect();

        this._floatRect = {
            ...this._floatRect,
            left: evt.clientX - containerRect.left - this._drag.offsetX,
            top: evt.clientY - containerRect.top - this._drag.offsetY,
        };

        this._applyLayout();

        const side = this._dockSideAt(
            this._floatRect,
            evt.clientX - containerRect.left,
            evt.clientY - containerRect.top,
            containerRect.width,
            containerRect.height,
        );

        if (!side) {
            this._drag.armed = true;
        }

        this._drag.side = this._drag.armed ? side : null;

        this._showDockPreview(this._drag.side);
    }

    _endMove() {
        const side = this._drag && this._drag.started ? this._drag.side : null;

        this._drag = null;

        this.classList.remove('dock-window-moving');

        this._showDockPreview(null);

        if (side) {
            this.dock(side);
        }
    }

    // =====================================================
    // RESIZE (edges and corners)
    // =====================================================

    _startResize(evt, dir) {
        if (evt.button !== 0) {
            return;
        }

        evt.preventDefault();
        evt.stopPropagation();

        const containerRect = this.parentElement.getBoundingClientRect();
        const rect = this.getBoundingClientRect();

        this._drag = {
            dir,
            startX: evt.clientX,
            startY: evt.clientY,
            rect: {
                left: rect.left - containerRect.left,
                top: rect.top - containerRect.top,
                width: rect.width,
                height: rect.height,
            },
        };

        this.classList.add('dock-window-resizing');

        this._trackPointer(evt.currentTarget, evt, (moveEvt) => this._onResize(moveEvt), () => {
            this._drag = null;

            this.classList.remove('dock-window-resizing');
        });
    }

    _onResize(evt) {
        const { dir, startX, startY, rect } = this._drag;
        const dx = evt.clientX - startX;
        const dy = evt.clientY - startY;

        if (this._state === 'left') {
            this._dockSize.left = rect.width + dx;
        } else if (this._state === 'right') {
            this._dockSize.right = rect.width - dx;
        } else if (this._state === 'bottom') {
            this._dockSize.bottom = rect.height - dy;
        } else {
            let { left, top, width, height } = rect;

            if (dir.includes('e')) {
                width = rect.width + dx;
            }

            if (dir.includes('w')) {
                width = Math.max(MIN_WIDTH, rect.width - dx);
                left = rect.left + rect.width - width;
            }

            if (dir.includes('s')) {
                height = rect.height + dy;
            }

            if (dir.includes('n')) {
                height = Math.max(MIN_HEIGHT, rect.height - dy);
                top = rect.top + rect.height - height;
            }

            this._floatRect = { left, top, width, height };
        }

        this._applyLayout();
    }

    // =====================================================
    // POINTER TRACKING
    // =====================================================

    /**
     * Follows the pointer until it is released, with pointer capture on
     * the element that received the pointerdown.
     * @param {HTMLElement} element Element that received the pointerdown.
     * @param {Event} downEvent The pointerdown event.
     * @param {function(Event): void} onMove Called on each pointermove.
     * @param {function(): void} onEnd Called once, on pointerup or pointercancel.
     */
    _trackPointer(element, downEvent, onMove, onEnd) {
        const pointerId = downEvent.pointerId;

        element.setPointerCapture(pointerId);

        const move = (evt) => {
            if (evt.pointerId === pointerId) {
                onMove(evt);
            }
        };

        const end = (evt) => {
            if (evt.pointerId !== pointerId) {
                return;
            }

            element.removeEventListener('pointermove', move);
            element.removeEventListener('pointerup', end);
            element.removeEventListener('pointercancel', end);

            if (element.hasPointerCapture(pointerId)) {
                element.releasePointerCapture(pointerId);
            }

            onEnd();
        };

        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', end);
        element.addEventListener('pointercancel', end);
    }
}
