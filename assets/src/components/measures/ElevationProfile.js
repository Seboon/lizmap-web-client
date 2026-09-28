/**
 * @module components/measures/ElevationProfile.js
 * @name ElevationProfile
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../../modules/Globals.js';
import { getSettings, setSetting } from '../../modules/measures/Settings.js';
import { html, render, svg } from 'lit-html';

// Plotly: the one shipped with Lizmap for its dataviz plots
// (assets/js/dataviz/plotly-custom.min.js). Already on the page when the
// project has dataviz plots; otherwise loaded the first time the elevation
// profile is opened.
//
// Plotly works with the window of the graph (mouse events, sizes): when
// the profile is moved to a separate browser window (DockWindow "new
// window" button), a Plotly of that window is used, loaded there.
const plotlyPromises = new WeakMap();

/**
 * Loads Plotly once per browser window.
 * @param {object} [win] - Window of the graph (default: this page)
 * @returns {Promise<object>} The Plotly object of that window
 */
const loadPlotly = (win = window) => {
    if (win.Plotly) {
        return Promise.resolve(win.Plotly);
    }

    if (!plotlyPromises.has(win)) {
        plotlyPromises.set(win, new Promise((resolve, reject) => {
            const script = win.document.createElement('script');

            script.src = new URL(
                globalThis['lizUrls'].basepath + 'assets/js/dataviz/plotly-custom.min.js',
                window.location.href,
            ).href;
            script.onload = () => resolve(win.Plotly);
            script.onerror = () => {
                plotlyPromises.delete(win);

                script.remove();

                reject(new Error('Unable to load ' + script.src));
            };

            win.document.head.appendChild(script);
        }));
    }

    return plotlyPromises.get(win);
};

// "Nodes" icon (0-1000 square) of the button added to the Plotly modebar.
const NODES_ICON = {
    width: 1000,
    height: 1000,
    path:
        'M150,500 a90,90 0 1,0 180,0 a90,90 0 1,0 -180,0 ' +
        'M410,220 a90,90 0 1,0 180,0 a90,90 0 1,0 -180,0 ' +
        'M410,780 a90,90 0 1,0 180,0 a90,90 0 1,0 -180,0 ' +
        'M670,500 a90,90 0 1,0 180,0 a90,90 0 1,0 -180,0',
};

// Colors used when QGIS gives none (Plotly's default palette).
const FALLBACK_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];

// Opacity of the fills when the QGIS color gives none (opaque fill): a
// single curve is well visible, superposed curves stay readable through
// each other. A fill opacity chosen in the WebGIS is kept as is.
const FILL_OPACITY_SINGLE = 0.6;
const FILL_OPACITY_SUPERPOSED = 0.35;

/**
 * Parses a CSS color 'rgb(r,g,b)', 'rgba(r,g,b,a)' or '#rrggbb'.
 * @param {string} color - Color
 * @returns {{r: number, g: number, b: number, a: number}|null} Components
 */
const parseColor = (color) => {
    const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color || '');

    if (rgba) {
        return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
    }

    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color || '');

    if (hex) {
        return { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: 1 };
    }

    return null;
};

/**
 * '#rrggbb' of a color (for <input type="color">).
 * @param {string} color - Color
 * @returns {string} Hexadecimal color
 */
const toHex = (color) => {
    const c = parseColor(color);

    if (!c) {
        return '#000000';
    }

    return '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
};

/**
 * A color with the given opacity.
 * @param {string} color - Color
 * @param {number} opacity - Opacity (0 to 1)
 * @returns {string} 'rgba(r,g,b,a)'
 */
const withOpacity = (color, opacity) => {
    const c = parseColor(color);

    return c ? `rgba(${c.r},${c.g},${c.b},${Math.round(opacity * 100) / 100})` : color;
};

// Keys of the "layer panel collapsed" and "layer panel width" settings in
// the browser storage.
const COLLAPSED_STORAGE_KEY = 'lizmap-elevation-profile-layers-collapsed';
const WIDTH_STORAGE_KEY = 'lizmap-elevation-profile-layers-width';

// Limits of the width of the layer panel set with the splitter: at least
// 120 px, at most 70 % of the component.
const LAYERS_MIN_WIDTH = 120;
const LAYERS_MAX_RATIO = 0.7;
/**
 * The profile has at least one value.
 * @param {Array<number|null>} y - Elevations
 * @returns {boolean} Has data
 */
const hasData = (y) => y.some((v) => v != null && !isNaN(v));

/**
 * Elevation of a profile at a distance, interpolated between the two
 * closest sampled points (null where there is no data).
 * @param {number} target - Distance along the line
 * @param {number[]} xArr - Distances of the sampled points
 * @param {Array<number|null>} yArr - Elevations of the sampled points
 * @returns {number|null} Elevation
 */
const interpolate = (target, xArr, yArr) => {
    if (target <= xArr[0]) {
        return yArr[0];
    }

    for (let i = 1; i < xArr.length; i++) {
        if (xArr[i] >= target) {
            const y0 = yArr[i - 1];
            const y1 = yArr[i];

            if (y0 == null || y1 == null) {
                return y0 ?? y1;
            }

            const x0 = xArr[i - 1];
            const x1 = xArr[i];

            return x1 === x0 ? y0 : y0 + ((target - x0) / (x1 - x0)) * (y1 - y0);
        }
    }

    return yArr[yArr.length - 1];
};

/**
 * Display of the elevation profile (modules/measures/ElevationProfile.js):
 * tree of the elevation layers (with their QGIS groups and profile
 * colors) and Plotly graph of the checked layers, superposed, along the
 * active line.
 *
 * Hovering the graph shows the matching point on the map, and hovering
 * the line on the map moves the cursor of the graph; the elevation of
 * every checked layer is shown at the cursor.
 *
 * Clicking the symbol of a layer opens its style (representation, line
 * and fill colors, fill opacity), as in QGIS; the layer panel can be
 * collapsed, and widened or narrowed with the splitter between it and the
 * graph. The component can be moved to another browser window: its
 * graph is then drawn again there.
 * @class
 * @name ElevationProfile
 * @augments HTMLElement
 */
export default class ElevationProfile extends HTMLElement {
    constructor() {
        super();

        this._Plotly = null;
        this._graphDiv = null;
        this._resizeObserver = null;
        this._pendingUpdate = null;

        // Incremented on each graph change, so that an outdated render
        // (waiting for Plotly to load) is dropped.
        this._renderId = 0;

        // Profiles drawn on the graph ({layer, y, color}), in the layer
        // tree order.
        this._curves = [];

        // Index of a trace of a profile (for Plotly.Fx.hover), of the trace
        // of the nodes, and range of the y axis.
        this._hoverCurveNumber = 0;
        this._nodesTraceNumber = 0;
        this._yRange = [0, 0];

        this._onLayers = () => this._render();
        this._onProfileChanged = () => {
            this._render();
            this._renderGraph();
        };
        this._onHover = (evt) => this._showMapHover(evt.index);
        this._onNodesVisible = () => this._updateNodesVisibility();

        // Id of the layer whose style is being edited, or null.
        this._editedLayerId = null;

        this._layersCollapsed = false;

        // Width (px) of the layer panel set with the splitter, or null
        // (default width of the style sheet).
        this._layersWidth = null;

        try {
            this._layersCollapsed = globalThis.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';

            const width = Number(globalThis.localStorage.getItem(WIDTH_STORAGE_KEY));

            this._layersWidth = width >= LAYERS_MIN_WIDTH ? width : null;
        } catch {
            // Storage unavailable: panel expanded, default width.
        }
    }

    connectedCallback() {
        this.classList.add('lizmap-elevation-profile');

        // Downloads Plotly in the background while the layers load.
        loadPlotly(this._window)
            .then((Plotly) => {
                this._Plotly = Plotly;
            })
            .catch((error) => console.error('Elevation profile: unable to load Plotly', error));

        this._render();

        mainEventDispatcher.addListener(this._onLayers, 'measures.profile.layers');
        mainEventDispatcher.addListener(this._onProfileChanged, 'measures.profile.changed');
        mainEventDispatcher.addListener(this._onHover, 'measures.profile.hover');
        mainEventDispatcher.addListener(this._onNodesVisible, 'measures.profile.nodesVisible');
        mainEventDispatcher.addListener(this._onLayers, 'measures.settings.changed');

        // Moved to another window (or back): the graph removed when it was
        // detached is drawn again.
        if (this._module.profile) {
            this._renderGraph();
        }
    }

    /**
     * Browser window of the component (this page, or a separate window).
     * @type {object}
     */
    get _window() {
        return this.ownerDocument.defaultView || window;
    }

    disconnectedCallback() {
        mainEventDispatcher.removeListener(this._onLayers, 'measures.profile.layers');
        mainEventDispatcher.removeListener(this._onProfileChanged, 'measures.profile.changed');
        mainEventDispatcher.removeListener(this._onHover, 'measures.profile.hover');
        mainEventDispatcher.removeListener(this._onNodesVisible, 'measures.profile.nodesVisible');
        mainEventDispatcher.removeListener(this._onLayers, 'measures.settings.changed');

        this._removeGraph();
    }

    /**
     * The elevation profile module.
     * @type {object}
     */
    get _module() {
        return mainLizmap.elevationProfile;
    }

    /**
     * Style of the curve of a layer (QGIS style, or the one chosen in the
     * WebGIS), with a default line color when there is none.
     * @param {object} layer - Elevation layer
     * @returns {{symbology: string, line: string, fill: string, fillOpacity: number|null, changed: boolean}} Style
     */
    _style(layer) {
        const style = this._module.layerStyle(layer);
        const index = Math.max(0, this._module.layers.indexOf(layer));
        const line = style.line_color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];

        return {
            symbology: style.symbology,
            line,
            fill: style.fill_color || line,
            fillOpacity: style.fill_opacity,
            changed: style.changed,
        };
    }

    /**
     * Color of the fill of a curve on the graph.
     * @param {object} style - Style (see _style)
     * @param {number} curveCount - Number of curves drawn
     * @returns {string} Color
     */
    _fillColor(style, curveCount) {
        if (style.fillOpacity !== null) {
            return withOpacity(style.fill, style.fillOpacity);
        }

        const alpha = parseColor(style.fill)?.a ?? 1;
        const max = curveCount > 1 ? FILL_OPACITY_SUPERPOSED : FILL_OPACITY_SINGLE;

        return withOpacity(style.fill, Math.min(alpha, max));
    }

    // =====================================================
    // LAYER TREE AND MESSAGES (lit-html)
    // =====================================================

    /**
     * Builds the tree of the layers from their group paths.
     * @param {object[]} layers - Elevation layers, in the layer tree order
     * @returns {object[]} Nodes: {layer} or {name, children}
     */
    _buildTree(layers) {
        const root = [];

        layers.forEach((layer) => {
            let children = root;

            (layer.group || []).forEach((name) => {
                let group = children.find((node) => node.children && node.name === name);

                if (!group) {
                    group = { name, children: [] };
                    children.push(group);
                }

                children = group.children;
            });

            children.push({ layer });
        });

        return root;
    }

    /**
     * Ids of all the layers under a tree node.
     * @param {object} node - Tree node
     * @returns {string[]} Layer ids
     */
    _nodeLayerIds(node) {
        return node.layer ? [node.layer.id] : node.children.flatMap((child) => this._nodeLayerIds(child));
    }

    /**
     * Symbol of a layer in the tree: its profile symbology (line, fill
     * below or above the line) with its QGIS colors.
     * @param {object} layer - Elevation layer
     * @returns {object} lit-html template
     */
    _swatchTemplate(layer) {
        const style = this._style(layer);
        const fill = style.fillOpacity !== null ? withOpacity(style.fill, style.fillOpacity) : style.fill;

        // A button: a click opens the style of the layer (and doesn't check
        // or uncheck it).
        return html`<button type="button" class="elevation-profile-swatch-button"
                title=${lizDict['measures.profile.style.edit']}
                aria-expanded=${this._editedLayerId === layer.id ? 'true' : 'false'}
                @click=${(event) => {
        event.preventDefault();
        this._editedLayerId = this._editedLayerId === layer.id ? null : layer.id;
        this._render();
    }}><svg class="elevation-profile-swatch" viewBox="0 0 18 12" width="18" height="12" aria-hidden="true">${
    style.symbology === 'fill_below'
        ? svg`<rect x="0" y="6" width="18" height="6" fill=${fill}></rect>`
        : style.symbology === 'fill_above'
            ? svg`<rect x="0" y="0" width="18" height="6" fill=${fill}></rect>`
            : ''
}<line x1="0" y1="6" x2="18" y2="6" stroke=${style.line} stroke-width="2"></line></svg></button>`;
    }

    /**
     * Style editor of a layer, shown under it in the tree: representation
     * (line, fill below or above), line and fill colors, fill opacity, and
     * back to the QGIS style. Changes are applied to the graph at once and
     * remembered in the browser for this project.
     *
     * The editor takes the full width of the layer panel, whatever the
     * depth of the layer in the groups (it is shifted back by the
     * indentation of the groups).
     * @param {object} layer - Elevation layer
     * @param {number} depth - Group depth of the layer
     * @returns {object} lit-html template
     */
    _styleEditorTemplate(layer, depth) {
        const module = this._module;
        const style = this._style(layer);
        const filled = style.symbology !== 'line';
        const curveCount = Math.max(1, module.visibleProfiles().filter(({ y }) => hasData(y)).length);
        const opacity = Math.round((parseColor(this._fillColor(style, curveCount))?.a ?? 1) * 100);
        const set = (changes) => module.setLayerStyle(layer.id, changes);

        // Each text on its own line above its control when the panel is
        // narrow: long translations are never cut.
        return html`<div class="elevation-profile-style" style=${`--elevation-profile-depth: ${depth}`}>
                <label class="elevation-profile-style-field-wide">
                    <span class="elevation-profile-style-label">${lizDict['measures.profile.style.symbology']}</span>
                    <select @change=${(event) => set({ symbology: event.target.value })}>
                        ${['line', 'fill_below', 'fill_above'].map((value) => html`<option value=${value} ?selected=${style.symbology === value}>${lizDict[`measures.profile.style.${value}`]}</option>`)}
                    </select>
                </label>
                <label>
                    <span class="elevation-profile-style-label">${lizDict['measures.profile.style.lineColor']}</span>
                    <input type="color" .value=${toHex(style.line)}
                        @input=${(event) => set({ line_color: withOpacity(event.target.value, 1) })}>
                </label>
                <label ?hidden=${!filled}>
                    <span class="elevation-profile-style-label">${lizDict['measures.profile.style.fillColor']}</span>
                    <input type="color" .value=${toHex(style.fill)}
                        @input=${(event) => set({ fill_color: withOpacity(event.target.value, 1) })}>
                </label>
                <label class="elevation-profile-style-field-wide" ?hidden=${!filled}>
                    <span class="elevation-profile-style-label">${lizDict['measures.profile.style.opacity']}</span>
                    <span class="elevation-profile-style-control">
                        <input type="range" min="0" max="100" step="5" .value=${String(opacity)}
                            @input=${(event) => set({ fill_opacity: Number(event.target.value) / 100 })}>
                        <span class="elevation-profile-style-value">${opacity} %</span>
                    </span>
                </label>
                <button type="button" class="elevation-profile-style-reset" ?disabled=${!style.changed}
                    @click=${() => set(null)}>${lizDict['measures.profile.style.reset']}</button>
            </div>`;
    }

    /**
     * Item of the layer tree: a layer, or a group and its content.
     * @param {object} node - Tree node
     * @param {number} [depth] - Group depth of the node (0: top level)
     * @returns {object} lit-html template
     */
    _nodeTemplate(node, depth = 0) {
        const module = this._module;

        if (node.layer) {
            const layer = node.layer;

            return html`<li class="elevation-profile-tree-layer">
                <label title=${layer.title}>
                    <input type="checkbox" .checked=${module.isLayerVisible(layer.id)}
                        @change=${(event) => module.setLayersVisible([layer.id], event.target.checked)}>
                    ${this._swatchTemplate(layer)}
                    <span class="elevation-profile-tree-label">${layer.title}</span>
                    ${module.isLayerLoading(layer.id) ? html`<span class="elevation-profile-spinner" aria-hidden="true"></span>` : ''}
                </label>
                ${this._editedLayerId === layer.id ? this._styleEditorTemplate(layer, depth) : ''}
            </li>`;
        }

        const ids = this._nodeLayerIds(node);
        const checkedCount = ids.filter((id) => module.isLayerVisible(id)).length;

        return html`<li class="elevation-profile-tree-group">
                <label title=${node.name}>
                    <input type="checkbox" .checked=${checkedCount === ids.length}
                        .indeterminate=${checkedCount > 0 && checkedCount < ids.length}
                        @change=${(event) => module.setLayersVisible(ids, event.target.checked)}>
                    <span class="elevation-profile-tree-label">${node.name}</span>
                </label>
                <ul>${node.children.map((child) => this._nodeTemplate(child, depth + 1))}</ul>
            </li>`;
    }

    /**
     * Display settings on the map, shared with the measure tools: length
     * of the segments, help next to the pointer.
     * @returns {object} lit-html template
     */
    _displayTemplate() {
        const settings = getSettings();

        return html`
            <div class="elevation-profile-layers-title">${lizDict['measures.profile.display']}</div>
            <label class="elevation-profile-display-check">
                <input type="checkbox" class="elevation-profile-segments" .checked=${settings.segments}
                    @change=${(event) => setSetting('segments', event.target.checked)}>
                <span>${lizDict['measures.measure.segments']}</span>
            </label>
            <label class="elevation-profile-display-check">
                <input type="checkbox" class="elevation-profile-tips" .checked=${settings.tips}
                    @change=${(event) => setSetting('tips', event.target.checked)}>
                <span>${lizDict['measures.measure.tips']}</span>
            </label>`;
    }

    _render() {
        const module = this._module;
        const layers = module.layers;
        const projectLayers = layers.filter((layer) => layer.source !== 'online');
        const onlineLayers = layers.filter((layer) => layer.source === 'online');
        // Curves that can be drawn (a layer with no value at all along the
        // line has none).
        const curves = module.visibleProfiles().filter(({ y }) => hasData(y));

        // Attributions of the checked layers that require one.
        const attributions = layers.filter((layer) => layer.attribution && module.isLayerVisible(layer.id));

        let hint = '';

        if (layers.length && !layers.some((layer) => module.isLayerVisible(layer.id))) {
            hint = lizDict['measures.profile.hint.nolayer'];
        } else if (layers.length && !module.hasLine) {
            hint = lizDict['measures.profile.hint.draw'];
        } else if (module.loading) {
            hint = lizDict['measures.profile.hint.loading'];
        }

        const collapsed = this._layersCollapsed;
        const toggleLabel = lizDict[collapsed ? 'measures.profile.layers.expand' : 'measures.profile.layers.collapse'];

        const template = html`
        <div class="elevation-profile-panels">
        <div class="elevation-profile-layers ${collapsed ? 'collapsed' : ''}"
            style=${!collapsed && this._layersWidth ? `flex-basis: ${this._layersWidth}px` : ''}>
            <div class="elevation-profile-layers-header">
                <button type="button" class="elevation-profile-layers-toggle" title=${toggleLabel} aria-label=${toggleLabel}
                    aria-expanded=${collapsed ? 'false' : 'true'} @click=${() => this._toggleLayers()}>
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                </button>
                <span class="elevation-profile-layers-title">${lizDict['measures.profile.layers']}</span>
            </div>
            <div class="elevation-profile-layers-content" ?hidden=${collapsed}>
                <ul class="elevation-profile-tree">${this._buildTree(projectLayers).map((node) => this._nodeTemplate(node))}</ul>
                ${onlineLayers.length
                    ? html`<div class="elevation-profile-layers-title">${lizDict['measures.profile.online']}</div>
                        <ul class="elevation-profile-tree">${onlineLayers.map((layer) => this._nodeTemplate({ layer }))}</ul>`
                    : ''}
                ${this._displayTemplate()}
            </div>
        </div>
        <div class="elevation-profile-splitter" ?hidden=${collapsed} title=${lizDict['measures.profile.layers.resize']}
            @pointerdown=${(event) => this._startResizeLayers(event)}
            @dblclick=${() => this._setLayersWidth(null)}></div>
        <div class="elevation-profile-graph-column">
            <div class="elevation-profile-hint" ?hidden=${!hint || curves.length > 0}>${hint}</div>
            <div class="elevation-profile-graph-host"></div>
            <div class="elevation-profile-attribution" ?hidden=${attributions.length === 0}>${attributions.map((layer) => html`<span>${layer.title} : ${layer.attribution}</span>`)}</div>
        </div>
        </div>`;

        render(template, this);
    }

    /**
     * Drag of the splitter: sets the width of the layer panel (at least
     * LAYERS_MIN_WIDTH, at most LAYERS_MAX_RATIO of the component).
     * @param {Event} event - pointerdown on the splitter
     */
    _startResizeLayers(event) {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();

        const splitter = event.currentTarget;
        const layers = this.querySelector('.elevation-profile-layers');
        const startX = event.clientX;
        const startWidth = layers.getBoundingClientRect().width;
        const maxWidth = this.getBoundingClientRect().width * LAYERS_MAX_RATIO;

        splitter.setPointerCapture(event.pointerId);
        splitter.classList.add('dragging');

        const onMove = (moveEvent) => {
            const width = Math.round(Math.max(LAYERS_MIN_WIDTH, Math.min(maxWidth, startWidth + moveEvent.clientX - startX)));

            // Applied directly while dragging; the graph follows through its
            // ResizeObserver.
            layers.style.flexBasis = `${width}px`;
            this._layersWidth = width;
        };

        const onUp = () => {
            splitter.removeEventListener('pointermove', onMove);
            splitter.removeEventListener('pointerup', onUp);
            splitter.removeEventListener('pointercancel', onUp);
            splitter.classList.remove('dragging');

            this._setLayersWidth(this._layersWidth);
        };

        splitter.addEventListener('pointermove', onMove);
        splitter.addEventListener('pointerup', onUp);
        splitter.addEventListener('pointercancel', onUp);
    }

    /**
     * Sets (and remembers in the browser) the width of the layer panel;
     * null: back to the default width.
     * @param {number|null} width - Width in px
     */
    _setLayersWidth(width) {
        this._layersWidth = width;

        try {
            if (width) {
                globalThis.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
            } else {
                globalThis.localStorage.removeItem(WIDTH_STORAGE_KEY);
            }
        } catch {
            // Storage unavailable: kept until the page is closed.
        }

        this._render();
    }

    /**
     * Collapses or expands the layer panel (remembered in the browser).
     */
    _toggleLayers() {
        this._layersCollapsed = !this._layersCollapsed;

        try {
            globalThis.localStorage.setItem(COLLAPSED_STORAGE_KEY, this._layersCollapsed ? '1' : '0');
        } catch {
            // Storage unavailable: kept until the page is closed.
        }

        this._render();
    }

    // =====================================================
    // GRAPH (Plotly)
    // =====================================================

    // Removes the graph right away from the page, but only purges it once
    // the pending Plotly updates (relayout of the vertical line and its
    // asynchronous redraws) are over: purging it in the middle of them made
    // Plotly fail on its own internal state.
    _removeGraph() {
        this._renderId++;

        this._curves = [];

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        const graphDiv = this._graphDiv;
        const Plotly = this._Plotly;

        this._graphDiv = null;

        if (!graphDiv) {
            return;
        }

        graphDiv.parentElement?.remove();

        if (Plotly) {
            Promise.resolve(this._pendingUpdate)
                .catch(() => {})
                .then(() => new Promise((resolve) => setTimeout(resolve, 100)))
                .then(() => {
                    try {
                        Plotly.purge(graphDiv);
                    } catch (error) {
                        console.warn('Elevation profile: Plotly purge error', error);
                    }
                });
        }

        this._pendingUpdate = null;
    }

    async _renderGraph() {
        this._removeGraph();

        const renderId = this._renderId;
        const profile = this._module.profile;
        const profiles = this._module.visibleProfiles().filter(({ y }) => hasData(y));

        if (!profile || profiles.length === 0) {
            return;
        }

        const win = this._window;
        const Plotly = await loadPlotly(win);

        // The profile changed (or the component was removed) meanwhile.
        if (renderId !== this._renderId || !this.isConnected) {
            return;
        }

        this._Plotly = Plotly;

        const x = profile.x;

        this._curves = profiles.map(({ layer, y }) => {
            const style = this._style(layer);

            return { layer, y, style, color: style.line };
        });

        const valid = this._curves.flatMap((curve) => curve.y.filter((v) => v != null && !isNaN(v)));
        const zMin = Math.min(...valid);
        const zMax = Math.max(...valid);
        const pad = Math.max((zMax - zMin) * 0.35, 1);
        const yRange = [zMin - pad, zMax + pad];

        this._yRange = yRange;

        const wrapper = this.ownerDocument.createElement('div');
        wrapper.className = 'elevation-profile-graph-wrapper';

        const graphDiv = this.ownerDocument.createElement('div');
        graphDiv.className = 'elevation-profile-graph-inner';

        wrapper.appendChild(graphDiv);

        this.querySelector('.elevation-profile-graph-host').appendChild(wrapper);

        // The first layer of the tree is drawn last, i.e. on top, as in
        // QGIS.
        const traces = [];

        [...this._curves].reverse().forEach((curve) => {
            const { layer, y, color, style } = curve;
            const fillcolor = this._fillColor(style, this._curves.length);

            // "Fill above": filled up to an invisible line at the top of the
            // graph.
            if (style.symbology === 'fill_above') {
                traces.push({
                    x,
                    y: x.map(() => yRange[1]),
                    mode: 'lines',
                    line: { width: 0 },
                    hoverinfo: 'skip',
                    showlegend: false,
                });
            }

            this._hoverCurveNumber = traces.length;

            traces.push({
                x,
                y,
                name: layer.title,
                mode: 'lines',
                line: { color, width: 1.5 },
                fill: style.symbology === 'fill_below' ? 'tozeroy' : style.symbology === 'fill_above' ? 'tonexty' : 'none',
                fillcolor,
                connectgaps: false,
                hovertemplate: '%{y:.2f} m<extra></extra>',
            });
        });

        // Nodes of the line, on the curve of the first checked layer of the
        // tree that has a value there.
        const nodesY = profile.vertices.map((distance) => {
            for (const curve of this._curves) {
                const value = interpolate(distance, x, curve.y);

                if (value != null) {
                    return value;
                }
            }

            return null;
        });

        this._nodesTraceNumber = traces.length;

        traces.push({
            x: profile.vertices,
            y: nodesY,
            mode: 'markers',
            visible: this._module.nodesVisible,
            // Nodes at the edges of the axis ranges are not cut off.
            cliponaxis: false,
            marker: { size: 7, color: '#ffffff', line: { color: '#666', width: 1.5 } },
            // Hover handled by the profile traces only.
            hoverinfo: 'skip',
            showlegend: false,
        });

        const layout = {
            autosize: true,
            // Only hover is used (sync with the map): no pan/zoom.
            dragmode: false,
            // The layer tree is the legend.
            showlegend: false,
            margin: { l: 45, r: 20, t: 45, b: 35 },
            hovermode: 'x',
            xaxis: {
                showgrid: true,
                // Fixed ranges: the graph size doesn't shift whether the
                // node trace is shown or not.
                range: [x[0], x[x.length - 1]],
                ticksuffix: ' m',
                tickfont: { size: 9 },
                // No axis drag strip (it desynced the vertical line).
                fixedrange: true,
            },
            yaxis: {
                range: yRange,
                ticksuffix: ' m',
                tickfont: { size: 9 },
                fixedrange: true,
            },
            shapes: [],
        };

        Plotly.newPlot(graphDiv, traces, layout, {
            responsive: true,
            scrollZoom: false,
            modeBarButtonsToRemove: [
                'lasso2d',
                'select2d',
                'zoom2d',
                'pan2d',
                'zoomIn2d',
                'zoomOut2d',
                'autoScale2d',
                'resetScale2d',
            ],
            modeBarButtonsToAdd: [
                {
                    name: 'toggleNodes',
                    title: lizDict['measures.profile.toggleNodes'],
                    icon: NODES_ICON,
                    // Same button for the nodes of the graph and of the map.
                    click: () => {
                        this._module.nodesVisible = !this._module.nodesVisible;
                    },
                },
            ],
        });

        this._graphDiv = graphDiv;

        this._forcePlotContainerSize();

        // Follows every size change of the graph area (window resized,
        // docked, floated...).
        this._resizeObserver = new win.ResizeObserver(() => {
            if (this._graphDiv) {
                this._forcePlotContainerSize();

                Plotly.Plots.resize(this._graphDiv);
            }
        });

        this._resizeObserver.observe(wrapper);

        // Hovering the graph moves its cursor and shows the matching point
        // on the map. All the curves share the same points: the index of
        // the hovered point is the same for all of them.
        graphDiv.on('plotly_hover', (evt) => {
            const point = evt.points[0];

            this._updateCursor(point.pointNumber);

            this._module.showMarker(point.pointNumber);
        });

        graphDiv.on('plotly_unhover', () => {
            this._removeCursor();

            this._module.hideMarker();
        });
    }

    // Plotly (re)creates its '.plot-container.plotly' div without sizing it
    // to its parent: the size is forced inline.
    _forcePlotContainerSize() {
        const plotContainer = this._graphDiv?.querySelector('.plot-container.plotly');

        if (plotContainer) {
            plotContainer.style.position = 'relative';
            plotContainer.style.width = '100%';
            plotContainer.style.height = '100%';
        }
    }

    _updateNodesVisibility() {
        if (this._graphDiv) {
            this._pendingUpdate = this._Plotly.restyle(
                this._graphDiv,
                { visible: this._module.nodesVisible },
                [this._nodesTraceNumber],
            );
        }
    }

    // =====================================================
    // CURSOR OF THE GRAPH
    // =====================================================

    /**
     * Moves the cursor of the graph to the point of the profile hovered on
     * the map (index null: removes it).
     * @param {number|null} index - Index in the profile samples
     */
    _showMapHover(index) {
        if (!this._graphDiv || this._curves.length === 0) {
            return;
        }

        if (index === null || index === undefined) {
            this._removeCursor();

            return;
        }

        // Fx.hover first, the relayout of the cursor after: in the other
        // order, the relayout cleared the hover state Fx.hover had just set.
        this._Plotly.Fx.hover(this._graphDiv, [{ curveNumber: this._hoverCurveNumber, pointNumber: index }]);

        this._updateCursor(index);
    }

    /**
     * Draws the cursor at a sampled point: vertical line, a dot on each
     * curve, the distance under the x axis and a box with the elevation of
     * each checked layer.
     * @param {number} index - Index in the profile samples
     */
    _updateCursor(index) {
        const profile = this._module.profile;

        if (!this._graphDiv || !profile) {
            return;
        }

        const x = profile.x[index];

        if (x === undefined) {
            return;
        }

        const values = this._curves.map((curve) => ({ ...curve, value: curve.y[index] }));
        const known = values.filter((item) => item.value != null && !isNaN(item.value));

        const dotted = { color: 'black', width: 1, dash: 'dot' };
        const labelFont = { size: 9 };
        const labelBackground = 'rgba(255,255,255,0.85)';

        const top = known.length ? Math.max(...known.map((item) => item.value)) : null;

        const shapes = [
            // Distance already covered, along the x axis.
            { type: 'line', xref: 'x', x0: 0, x1: x, yref: 'y domain', y0: 0, y1: 0, line: dotted },
        ];

        if (top !== null) {
            // Vertical line from the bottom of the graph to the highest
            // curve.
            shapes.push({ type: 'line', xref: 'x', x0: x, x1: x, yref: 'y', y0: this._yRange[0], y1: top, line: dotted });
        }

        // A dot on each curve (fixed size in pixels).
        known.forEach((item) => {
            shapes.push({
                type: 'circle',
                xref: 'x',
                yref: 'y',
                xsizemode: 'pixel',
                ysizemode: 'pixel',
                xanchor: x,
                yanchor: item.value,
                x0: -3.5,
                x1: 3.5,
                y0: -3.5,
                y1: 3.5,
                fillcolor: item.color,
                line: { color: '#fff', width: 1 },
            });
        });

        // Elevation of each checked layer, in the layer tree order (layers
        // with no value there: "-").
        const lines = values.map(
            (item) =>
                `<span style="color:${item.color}">■</span> ${item.layer.title} : ` +
                (item.value != null && !isNaN(item.value) ? `${item.value.toFixed(2)} m` : '-'),
        );

        // The box stays inside the graph: on the right of the cursor in the
        // left half, on its left otherwise.
        const range = [profile.x[0], profile.x[profile.x.length - 1]];
        const leftHalf = x - range[0] <= (range[1] - range[0]) / 2;

        this._pendingUpdate = this._Plotly.relayout(this._graphDiv, {
            shapes,
            annotations: [
                {
                    x,
                    xref: 'x',
                    y: 0,
                    yref: 'y domain',
                    yanchor: 'top',
                    yshift: -14,
                    text: `${x.toFixed(2)} m`,
                    showarrow: false,
                    font: labelFont,
                    bgcolor: labelBackground,
                },
                {
                    x,
                    xref: 'x',
                    y: 1,
                    yref: 'y domain',
                    yanchor: 'top',
                    xanchor: leftHalf ? 'left' : 'right',
                    xshift: leftHalf ? 6 : -6,
                    align: 'left',
                    text: lines.join('<br>'),
                    showarrow: false,
                    font: labelFont,
                    bgcolor: labelBackground,
                    bordercolor: '#bbb',
                    borderwidth: 1,
                    borderpad: 3,
                },
            ],
        });
    }

    _removeCursor() {
        if (this._graphDiv) {
            this._pendingUpdate = this._Plotly.relayout(this._graphDiv, { shapes: [], annotations: [] });
        }
    }
}
