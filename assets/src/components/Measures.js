/**
 * @module components/Measures.js
 * @name Measures
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';

/**
 * Measure tools of the "Measure" menu of the top bar.
 *
 * Placed in the menu (measure_menu.tpl), which works like the "Measure"
 * button of the QGIS Desktop toolbar:
 * - the main button (`.measure-menu-run`) starts the current tool, and
 *   stops it if it is already running (it then looks pressed);
 * - the small arrow next to it (`.dropdown-toggle`) opens the list of
 *   the tools (`data-measure-tool` attribute). Choosing one starts it and
 *   makes it the current tool: its icon goes on the main button, and the
 *   browser remembers it.
 *
 * Tools: length, area, angle and bearing (Measure module, in a small
 * window with their settings and results), and the elevation profile
 * (ElevationProfile module, in a window docked at the bottom of the map).
 * As in QGIS Desktop, one tool runs at a time: starting a tool stops the
 * other one, and closes the open tool of the Lizmap mini-dock (drawing,
 * selection, printing...); opening a mini-dock tool stops the measure
 * tool. An entry whose tool doesn't exist is greyed out.
 * @class
 * @name Measures
 * @augments HTMLElement
 */
export default class Measures extends HTMLElement {
    constructor() {
        super();

        /**
         * Window of the open elevation profile, or null.
         * @type {HTMLElement|null}
         */
        this._profileWindow = null;

        /**
         * Window of the open measure tool (length, area, angle, bearing), or
         * null.
         * @type {HTMLElement|null}
         */
        this._measureWindow = null;

        this._onMenuClick = (event) => this._handleMenuClick(event);
        this._onProfileUnavailable = () => this.closeElevationProfile();

        // A tool of the Lizmap mini-dock is opened: the measure tools stop.
        this._onMiniDockOpened = () => {
            this.closeMeasure();
            this.closeElevationProfile();
        };
        this._miniDockEvents = null;
    }

    /**
     * Key of the last chosen tool in the browser storage.
     * @type {string}
     */
    static get LAST_TOOL_KEY() {
        return 'lizmap-measure-last-tool';
    }

    /**
     * Tools that exist, in the order of preference for the default tool.
     * @type {string[]}
     */
    static get AVAILABLE_TOOLS() {
        return ['length', 'area', 'angle', 'bearing', 'profile'];
    }

    connectedCallback() {
        this._menu = this.closest('.measure-menu-item') || this.parentElement;
        this._runButton = this._menu.querySelector('.measure-menu-run');

        this._menu.addEventListener('click', this._onMenuClick);

        mainEventDispatcher.addListener(this._onProfileUnavailable, 'measures.profile.unavailable');

        // Tools that don't exist yet: greyed out in the list.
        this._menu.querySelectorAll('[data-measure-tool]').forEach((item) => {
            if (!Measures.AVAILABLE_TOOLS.includes(item.dataset.measureTool)) {
                item.parentElement.classList.add('disabled');
                item.setAttribute('aria-disabled', 'true');
            }
        });

        // Current tool: the last chosen one, as in QGIS Desktop
        // (remembered in the browser), else the first available tool.
        let lastTool = null;

        try {
            lastTool = globalThis.localStorage.getItem(Measures.LAST_TOOL_KEY);
        } catch {
            // Storage unavailable: default tool.
        }

        if (!Measures.AVAILABLE_TOOLS.includes(lastTool)) {
            lastTool = Measures.AVAILABLE_TOOLS[0];
        }

        const entry = this._entry(lastTool);

        if (entry) {
            this._showToolInMenu(entry);
        }
    }

    /**
     * Entry of the list for a tool.
     * @param {string} tool - Tool name (data-measure-tool)
     * @returns {HTMLElement|null} The entry, or null
     */
    _entry(tool) {
        return this._menu.querySelector(`[data-measure-tool="${CSS.escape(tool)}"]`);
    }

    /**
     * Makes a tool the current tool: its icon on the main button, and its
     * name as tooltip.
     * @param {HTMLElement} entry - Entry of the menu ([data-measure-tool])
     */
    _showToolInMenu(entry) {
        this._currentTool = entry.dataset.measureTool;

        const icon = entry.querySelector('img');
        const runIcon = this._runButton?.querySelector('img');

        if (!icon || !runIcon) {
            return;
        }

        const name = entry.textContent.trim();

        runIcon.src = icon.src;
        runIcon.alt = name;
        this._runButton.title = name;

        this._menu.querySelectorAll('[data-measure-tool]').forEach((item) => {
            item.parentElement.classList.toggle('active', item === entry);
        });
    }

    disconnectedCallback() {
        this._menu?.removeEventListener('click', this._onMenuClick);

        mainEventDispatcher.removeListener(this._onProfileUnavailable, 'measures.profile.unavailable');

        this.closeElevationProfile();
        this.closeMeasure();

        this._miniDockEvents?.un({ minidockopened: this._onMiniDockOpened });
        this._miniDockEvents = null;
    }

    /**
     * One map tool at a time: closes the open tool of the Lizmap mini-dock
     * (same effect as clicking its button), and listens to the mini-dock
     * so that opening one of its tools stops the measure tools.
     */
    _closeMiniDock() {
        const events = globalThis.lizMap?.events;

        if (events && !this._miniDockEvents) {
            events.on({ minidockopened: this._onMiniDockOpened });
            this._miniDockEvents = events;
        }

        document.querySelector('#mapmenu li.nav-minidock.active > a')?.click();
    }

    _handleMenuClick(event) {
        // Main button: starts the current tool, or stops it.
        if (this._runButton && event.target.closest('.measure-menu-run') === this._runButton) {
            event.preventDefault();

            if (this._isRunning(this._currentTool)) {
                this._stop(this._currentTool);
            } else {
                this._start(this._currentTool);
            }

            return;
        }

        const entry = event.target.closest('[data-measure-tool]');

        if (!entry) {
            return;
        }

        event.preventDefault();

        const tool = entry.dataset.measureTool;

        // Tool that doesn't exist yet: the list stays open.
        if (!Measures.AVAILABLE_TOOLS.includes(tool)) {
            event.stopPropagation();

            return;
        }

        this._showToolInMenu(entry);

        try {
            globalThis.localStorage.setItem(Measures.LAST_TOOL_KEY, tool);
        } catch {
            // Storage unavailable: the tool is kept until the page is closed.
        }

        this._start(tool);
    }

    /**
     * Whether a tool is running.
     * @param {string} tool - Tool name
     * @returns {boolean} True if the tool is running
     */
    _isRunning(tool) {
        if (tool === 'profile') {
            return Boolean(this._profileWindow);
        }

        return Boolean(this._measureWindow) && mainLizmap.measure?.tool === tool;
    }

    /**
     * Starts a tool (nothing if it is already running).
     * @param {string} tool - Tool name
     */
    _start(tool) {
        if (Measures.AVAILABLE_TOOLS.includes(tool)) {
            this._closeMiniDock();
        }

        if (tool === 'profile') {
            this.closeMeasure();
            this.openElevationProfile();
        } else if (Measures.AVAILABLE_TOOLS.includes(tool)) {
            this.closeElevationProfile();
            this.openMeasure(tool);
        }
    }

    /**
     * Stops a tool.
     * @param {string} tool - Tool name
     */
    _stop(tool) {
        if (tool === 'profile') {
            this.closeElevationProfile();
        } else {
            this.closeMeasure();
        }
    }

    /**
     * The main button looks pressed while the current tool runs, like a
     * checked tool button of QGIS Desktop.
     */
    _updateRunButton() {
        if (!this._runButton) {
            return;
        }

        const running = this._isRunning(this._currentTool);

        this._runButton.classList.toggle('active', running);
        this._runButton.setAttribute('aria-pressed', String(running));
    }

    /**
     * Opens the elevation profile in a window docked at the bottom of the
     * map, full width (280 px high). Does nothing if it is already open.
     *
     * The window can still be floated by dragging its title bar (or by
     * double-clicking it): it then appears at the top right of the map
     * (450 x 280 px).
     */
    openElevationProfile() {
        const container = document.getElementById('map-content');

        if (this._profileWindow || !container) {
            return;
        }

        const dockWindow = document.createElement('lizmap-dock-window');

        dockWindow.heading = lizDict['measures.profile.title'];
        this._setDockLabels(dockWindow);

        dockWindow.addEventListener('dockwindowclose', () => this.closeElevationProfile());

        container.appendChild(dockWindow);

        // Floating position used when the window is undocked, then docked
        // at the bottom.
        dockWindow.open({ width: 450, height: 280, top: 10, right: 60 });
        dockWindow.dock('bottom');

        // The display is added before the module is activated, so that it
        // receives the list of DEMs.
        dockWindow.body.appendChild(document.createElement('lizmap-elevation-profile'));

        this._profileWindow = dockWindow;
        this._updateRunButton();

        mainLizmap.elevationProfile.activate();
    }

    /**
     * Deactivates the elevation profile and removes its window.
     */
    closeElevationProfile() {
        if (!this._profileWindow) {
            return;
        }

        const dockWindow = this._profileWindow;

        this._profileWindow = null;
        this._updateRunButton();

        mainLizmap.elevationProfile.deactivate();

        dockWindow.remove();
    }

    /**
     * Tooltips of the buttons of a dock window.
     * @param {HTMLElement} dockWindow - <lizmap-dock-window>
     */
    _setDockLabels(dockWindow) {
        dockWindow.setAttribute('close-label', lizDict['dockwindow.close']);
        dockWindow.setAttribute('maximize-label', lizDict['dockwindow.maximize']);
        dockWindow.setAttribute('restore-label', lizDict['dockwindow.restore']);
        dockWindow.setAttribute('popout-label', lizDict['dockwindow.popout']);
        dockWindow.setAttribute('popin-label', lizDict['dockwindow.popin']);
    }

    /**
     * Name of a tool, as written in the menu.
     * @param {string} tool - Tool name
     * @returns {string} Name
     */
    _toolName(tool) {
        return this._entry(tool)?.textContent.trim() || tool;
    }

    /**
     * Opens a measure tool (length, area, angle, bearing) with its panel in
     * a small floating window at the top right of the map. If another
     * measure tool is open, its window is reused (its measures are
     * removed).
     * @param {string} tool - 'length', 'area', 'angle' or 'bearing'
     */
    openMeasure(tool) {
        const container = document.getElementById('map-content');
        const module = mainLizmap.measure;

        if (!container || !module) {
            return;
        }

        if (this._measureWindow) {
            this._measureWindow.heading = this._toolName(tool);

            module.activate(tool);

            this._updateRunButton();

            return;
        }

        const dockWindow = document.createElement('lizmap-dock-window');

        dockWindow.heading = this._toolName(tool);
        this._setDockLabels(dockWindow);

        dockWindow.addEventListener('dockwindowclose', () => this.closeMeasure());

        container.appendChild(dockWindow);

        dockWindow.open({ width: 320, height: 300, top: 10, right: 60 });

        module.activate(tool);

        dockWindow.body.appendChild(document.createElement('lizmap-measure-panel'));

        this._measureWindow = dockWindow;
        this._updateRunButton();
    }

    /**
     * Closes the measure tool: its measures are removed with its window.
     */
    closeMeasure() {
        if (!this._measureWindow) {
            return;
        }

        const dockWindow = this._measureWindow;

        this._measureWindow = null;
        this._updateRunButton();

        mainLizmap.measure?.deactivate();

        dockWindow.remove();
    }
}
