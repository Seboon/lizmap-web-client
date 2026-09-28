/**
 * @module modules/measures/ElevationProfile.js
 * @name ElevationProfile
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../Globals.js';
import { Utils } from '../Utils.js';
import { inverse, isMetricProjection } from './Geodesy.js';
import { isTypingTarget } from './Keyboard.js';
import { lineLengthStyles, tipStyle } from './Labels.js';
import { getSettings } from './Settings.js';
import {
    drawStyle,
    drawStyleNoPointer,
    hoveredVertexStyle,
    lineHoverStyle,
    lineStyle,
    nodeStyle,
    vertexStyle,
} from './Styles.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import VectorLayer from 'ol/layer/Vector.js';
import { transform } from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';

// Message ids (lizMap.addMessage), so they can be removed later.
const MESSAGE_ID = 'lizmap-profile-message';
const NO_LAYER_MESSAGE_ID = 'lizmap-profile-no-layer-message';
const NO_DATA_MESSAGE_ID = 'lizmap-profile-no-data-message';

/**
 * An elevation layer, as listed by GetElevationLayers: a layer of the
 * project declared as an elevation surface in QGIS (Layer Properties >
 * Elevation), or an online source (Copernicus). Only the layers the user
 * is allowed to read are listed.
 * @typedef {object} ElevationLayer
 * @property {string}      id              Layer id (value sent to QGIS Server)
 * @property {string}      name            Layer name
 * @property {string}      title           Displayed title
 * @property {string[]}    group           Path of its groups in the QGIS layer tree
 * @property {string}      source          'project' or 'online'
 * @property {boolean}     default_visible Checked when the tool opens
 * @property {string}      symbology       'line', 'fill_below' or 'fill_above' (QGIS profile symbology)
 * @property {string|null} line_color      Color of the line, 'rgba(r,g,b,a)'
 * @property {string|null} fill_color      Color of the fill, 'rgba(r,g,b,a)'
 * @property {string}      [attribution]   Attribution to display (online sources)
 */

/**
 * Profile of the active line. All the layers are sampled at the same
 * points.
 * @typedef {object} ElevationProfileData
 * @property {number[]}                         x        Distance (m) of each sampled point along the line
 * @property {number[][]}                       coords   Map coordinates of each sampled point
 * @property {number[]}                         vertices Distance (m) of each vertex of the line
 * @property {Map<string, Array<number|null>>}  values   Elevation of each sampled point, by layer id (null: no data)
 */

/**
 * Elevation profile along lines drawn on the map, computed by the QGIS
 * Server "PROFILE" service (GetElevationLayers / GetElevationProfile).
 *
 * This module holds the map side of the tool (drawing and editing the
 * lines, requests, state: elevation layers and which ones are checked);
 * the layer tree and the graph are displayed by the
 * <lizmap-elevation-profile> component, which listens to its events.
 *
 * Several elevation layers can be checked: their profiles are requested
 * together and drawn on the same graph.
 *
 * Several lines can coexist on the map (like QWC2's profile tool); the
 * active one is the one of the profile, and can be edited: drag a node to
 * move it, click on the line to insert a node, hover a node and press
 * Backspace to delete it, click on another line to make it active.
 *
 * Keyboard, as for the other measure tools: Escape cancels the line being
 * drawn and Backspace (or Delete) removes its last point; on a hovered
 * node, Backspace deletes the node (a line keeps at least two), on a
 * hovered line, it deletes the line.
 *
 * As for the measure tools, the length of the lines (and, if chosen, of
 * their segments) is shown on the map, and a help next to the pointer
 * tells what a click, a drag or Backspace would do (Settings.js).
 * @class
 * @name ElevationProfile
 * @fires ElevationProfile#measures.profile.layers
 * @fires ElevationProfile#measures.profile.changed
 * @fires ElevationProfile#measures.profile.hover
 * @fires ElevationProfile#measures.profile.nodesVisible
 * @fires ElevationProfile#measures.profile.unavailable
 */
export default class ElevationProfile {
    /**
     * Create the module; nothing is added to the map before activate().
     * @param {object} map - The Lizmap map (modules/map.js)
     * @param {object} lizmap3 - The old lizmap object
     */
    constructor(map, lizmap3) {
        this._map = map;
        this._lizmap3 = lizmap3;

        this._active = false;

        /** @type {ElevationLayer[]} */
        this._layers = [];

        // Ids of the checked layers.
        this._visibleIds = new Set();

        // Ids of the layers whose profile is being computed.
        this._loadingIds = new Set();

        // Styles changed in the WebGIS, by layer id ({symbology, line_color,
        // fill_color, fill_opacity}); remembered in the browser, per project.
        this._styleOverrides = this._readStyleOverrides();

        /** @type {ElevationProfileData|null} */
        this._profile = null;
        this._profileRequestId = 0;

        this._nodesVisible = true;

        // Index (in the profile samples) of the point hovered on the map,
        // or null.
        this._hoverIndex = null;

        this._vector = null;
        this._vectorSource = null;
        this._draw = null;
        this._modify = null;
        this._modifySource = null;
        this._nodesLayer = null;
        this._graphHoverMarkerLayer = null;

        this._lastCoords = null;
        this._activeLine = null;

        // State of the Lizmap popup before it was disabled, restored as it
        // was when the tool is closed.
        this._popupActiveBefore = null;

        // Line drawn with no elevation data, pending deletion.
        this._pendingEmptyLineFeature = null;
        this._pendingEmptyLineTimer = null;
        this._pendingEmptyLineMessageObserver = null;

        // The line whose hover/insertion marker is active: as in QWC2,
        // only the explicitly clicked (or just drawn / modified) line.
        this._hoverEnabledFeature = null;

        this._isDrawingLine = false;
        this._isModifyingVertex = false;
        this._hoverInsertCoord = null;
        this._hoverNearVertex = false;
        this._hoveredVertexCoord = null;

        // Hover hit-testing reads an OpenLayers-internal canvas: its
        // frequency is limited (see the pointermove listener).
        this._lastPointerMoveHitTestTime = 0;
        this._pointerMoveTimer = null;

        // True when the cursor is near an existing line or node: a new
        // line can't start there (see the condition and style of Draw).
        this._nearSnapTarget = false;

        // Hovered inactive line, highlighted to show that clicking it
        // would make it active.
        this._hoveredInactiveLine = null;

        // Line (active or not) under the pointer: Backspace deletes it.
        this._hoveredLine = null;

        this._onPointerDrag = () => this._handlePointerDrag();
        this._onPointerMove = (evt) => this._handlePointerMove(evt);
        this._onClick = (evt) => this._handleClick(evt);
        this._onKeyDown = (evt) => this._handleKeyDown(evt);
        this._onPointerLeave = () => this._handlePointerLeave();

        // Display settings (length of the segments, help) changed.
        this._onSettingsChanged = () => {
            this._vector?.changed();
            this._draw?.getOverlay().changed();
        };
    }

    /**
     * The tool is active.
     * @type {boolean}
     */
    get active() {
        return this._active;
    }

    /**
     * Elevation layers available for the profile, in the order of the QGIS
     * layer tree (online sources last).
     * @type {ElevationLayer[]}
     */
    get layers() {
        return this._layers;
    }

    /**
     * The layer is checked.
     * @param {string} id - Layer id
     * @returns {boolean} Checked
     */
    isLayerVisible(id) {
        return this._visibleIds.has(id);
    }

    /**
     * Profiles of the checked layers for the active line, in the order of
     * the layer tree; layers whose profile is not (yet) known are left
     * out.
     * @returns {Array<{layer: ElevationLayer, y: Array<number|null>}>} Profiles
     */
    visibleProfiles() {
        if (!this._profile) {
            return [];
        }

        return this._layers
            .filter((layer) => this._visibleIds.has(layer.id) && this._profile.values.has(layer.id))
            .map((layer) => ({ layer, y: this._profile.values.get(layer.id) }));
    }

    /**
     * A line is drawn and active (its profile may still be loading).
     * @type {boolean}
     */
    get hasLine() {
        return !!this._lastCoords;
    }

    // =====================================================
    // STYLE OF THE CURVES
    // =====================================================

    /**
     * Key of the styles in the browser storage (one per project).
     * @type {string}
     */
    get _styleStorageKey() {
        const params = globalThis['lizUrls']?.params || {};

        return `lizmap-elevation-profile-styles:${params.repository}:${params.project}`;
    }

    _readStyleOverrides() {
        try {
            const stored = JSON.parse(globalThis.localStorage.getItem(this._styleStorageKey) || '{}');

            return stored && typeof stored === 'object' ? stored : {};
        } catch {
            return {};
        }
    }

    _writeStyleOverrides() {
        try {
            if (Object.keys(this._styleOverrides).length) {
                globalThis.localStorage.setItem(this._styleStorageKey, JSON.stringify(this._styleOverrides));
            } else {
                globalThis.localStorage.removeItem(this._styleStorageKey);
            }
        } catch {
            // Storage unavailable (private browsing...): the styles last
            // until the page is closed.
        }
    }

    /**
     * Style of the curve of a layer: its QGIS profile symbology and colors,
     * or those chosen in the WebGIS.
     * @param {ElevationLayer} layer - Elevation layer
     * @returns {{symbology: string, line_color: string|null, fill_color: string|null, fill_opacity: number|null, changed: boolean}} Style
     */
    layerStyle(layer) {
        const override = this._styleOverrides[layer.id] || {};

        return {
            symbology: override.symbology || layer.symbology || 'line',
            line_color: override.line_color || layer.line_color || null,
            fill_color: override.fill_color || layer.fill_color || null,
            fill_opacity: typeof override.fill_opacity === 'number' ? override.fill_opacity : null,
            changed: Object.keys(override).length > 0,
        };
    }

    /**
     * Changes the style of the curve of a layer (null: back to the QGIS
     * style). The graph is drawn again.
     * @param {string} id - Layer id
     * @param {object|null} changes - {symbology, line_color, fill_color, fill_opacity}
     */
    setLayerStyle(id, changes) {
        if (changes === null) {
            delete this._styleOverrides[id];
        } else {
            this._styleOverrides[id] = { ...this._styleOverrides[id], ...changes };
        }

        this._writeStyleOverrides();

        this._dispatchLayersChanged();
        this._dispatchProfileChanged();
    }

    /**
     * The profile of the layer is being computed.
     * @param {string} id - Layer id
     * @returns {boolean} Loading
     */
    isLayerLoading(id) {
        return this._loadingIds.has(id);
    }

    /**
     * A profile is being computed.
     * @type {boolean}
     */
    get loading() {
        return this._loadingIds.size > 0;
    }

    /**
     * Profile of the active line, or null.
     * @type {ElevationProfileData|null}
     */
    get profile() {
        return this._profile;
    }

    /**
     * The nodes of the active line are shown (on the map and the graph).
     * @type {boolean}
     */
    get nodesVisible() {
        return this._nodesVisible;
    }

    set nodesVisible(visible) {
        this._nodesVisible = !!visible;

        this._nodesLayer?.setVisible(this._nodesVisible);

        /**
         * Nodes shown or hidden.
         * @event ElevationProfile#measures.profile.nodesVisible
         * @property {string} type measures.profile.nodesVisible
         */
        mainEventDispatcher.dispatch('measures.profile.nodesVisible');
    }

    // =====================================================
    // ACTIVATE / DEACTIVATE
    // =====================================================

    /**
     * Activates the tool: disables the Lizmap popup and loads the list of
     * elevation layers. Drawing starts once the list is loaded.
     */
    activate() {
        if (this._active) {
            return;
        }

        this._active = true;

        this._setPopupEnabled(false);

        document.addEventListener('keydown', this._onKeyDown);
        mainEventDispatcher.addListener(this._onSettingsChanged, 'measures.settings.changed');

        this._loadLayers();
    }

    /**
     * Deactivates the tool: removes the lines, layers and interactions it
     * added to the map, and restores the Lizmap popup.
     */
    deactivate() {
        if (!this._active) {
            return;
        }

        this._active = false;

        document.removeEventListener('keydown', this._onKeyDown);
        mainEventDispatcher.removeListener(this._onSettingsChanged, 'measures.settings.changed');

        this._removeMessage(MESSAGE_ID);
        this._removeMessage(NO_DATA_MESSAGE_ID);

        if (this._pendingEmptyLineTimer) {
            clearTimeout(this._pendingEmptyLineTimer);
            this._pendingEmptyLineTimer = null;
        }

        if (this._pendingEmptyLineMessageObserver) {
            this._pendingEmptyLineMessageObserver.disconnect();
            this._pendingEmptyLineMessageObserver = null;
        }

        this._pendingEmptyLineFeature = null;

        this._setPopupEnabled(true);

        this._removeModifyInteraction();

        this._hideExploreMarker();

        this.hideMarker();

        this._isDrawingLine = false;
        this._isModifyingVertex = false;
        this._hoverEnabledFeature = null;
        this._hoveredInactiveLine = null;

        if (this._draw) {
            this._map.removeInteraction(this._draw);
            this._draw = null;

            this._map.un('pointerdrag', this._onPointerDrag);
            this._map.un('pointermove', this._onPointerMove);
            this._map.un('click', this._onClick);
            this._map.getViewport().removeEventListener('pointerleave', this._onPointerLeave);
        }

        clearTimeout(this._pointerMoveTimer);
        this._hoveredLine = null;

        this._vectorSource?.clear();

        this._clearProfile();

        [this._vector, this._nodesLayer, this._graphHoverMarkerLayer].forEach((layer) => {
            if (layer) {
                this._map.removeToolLayer(layer);
            }
        });

        this._vector = null;
        this._vectorSource = null;
        this._nodesLayer = null;
        this._graphHoverMarkerLayer = null;

        this._layers = [];
        this._visibleIds.clear();
        this._loadingIds.clear();

        this._setCursor('');

        this._map.render();
    }

    /**
     * Checks or unchecks layers. The profile of a newly checked layer is
     * requested (with the other checked layers, so that all the curves
     * share the same points); unchecking a layer only hides its curve.
     * @param {string[]} ids - Layer ids
     * @param {boolean} visible - Checked
     */
    setLayersVisible(ids, visible) {
        ids.forEach((id) => {
            if (visible) {
                this._visibleIds.add(id);
            } else {
                this._visibleIds.delete(id);
            }
        });

        this._dispatchLayersChanged();

        if (!this._lastCoords) {
            return;
        }

        const missing = [...this._visibleIds].some((id) => !this._profile?.values.has(id));

        if (missing) {
            this._requestProfile(this._lastCoords);
        } else {
            this._dispatchProfileChanged();
        }
    }

    // =====================================================
    // GRAPH -> MAP (marker shown while hovering the graph)
    // =====================================================

    /**
     * Shows on the map the sampled point of the profile at the given index.
     * @param {number} index - Index in the profile samples
     */
    showMarker(index) {
        const coord = this._profile?.coords?.[index];

        if (!this._graphHoverMarkerLayer || !coord) {
            return;
        }

        const source = this._graphHoverMarkerLayer.getSource();

        source.clear();

        source.addFeature(new Feature({ geometry: new Point(coord) }));
    }

    /**
     * Hides the marker shown by showMarker().
     */
    hideMarker() {
        this._graphHoverMarkerLayer?.getSource().clear();
    }

    // =====================================================
    // EVENTS
    // =====================================================

    _dispatchProfileChanged() {
        /**
         * Profile of the active line computed or cleared, or the checked
         * layers changed: the graph must be drawn again.
         * @event ElevationProfile#measures.profile.changed
         * @property {string} type measures.profile.changed
         */
        mainEventDispatcher.dispatch('measures.profile.changed');
    }

    _dispatchLayersChanged() {
        /**
         * List of elevation layers loaded, or layers checked/unchecked.
         * @event ElevationProfile#measures.profile.layers
         * @property {string} type measures.profile.layers
         */
        mainEventDispatcher.dispatch('measures.profile.layers');
    }

    /**
     * Sets the point of the profile hovered on the map.
     * @param {number|null} index - Index in the profile samples, or null
     */
    _setHoverIndex(index) {
        if (index === this._hoverIndex) {
            return;
        }

        this._hoverIndex = index;

        /**
         * Point of the profile hovered on the map (index null: none).
         * @event ElevationProfile#measures.profile.hover
         * @property {string}      type  measures.profile.hover
         * @property {number|null} index Index in the profile samples
         */
        mainEventDispatcher.dispatch({ type: 'measures.profile.hover', index });
    }

    // =====================================================
    // MESSAGES (Lizmap message bar)
    // =====================================================

    /**
     * Shows a message in the Lizmap message bar.
     * @param {string} text - Text
     * @param {string} type - 'info', 'warning' or 'error'
     * @param {string} id - Id of the message element
     * @returns {HTMLElement|undefined} The message element
     */
    _addMessage(text, type, id) {
        return this._lizmap3.addMessage(text, type, true).attr('id', id)[0];
    }

    _removeMessage(id) {
        document.getElementById(id)?.remove();
    }

    _setCursor(cursor) {
        const target = this._map.getTargetElement();

        if (target) {
            target.style.cursor = cursor;
        }
    }

    // =====================================================
    // REQUESTS TO THE PROFILE SERVICE
    // =====================================================

    /**
     * Sends a request of the PROFILE service of the ElevationProfile QGIS
     * Server plugin, through the Lizmap OGC proxy (lizUrls.wms) like every
     * other map request: Lizmap checks the access to the project and adds
     * the user headers used by QGIS Server for the layer access rights.
     * Lizmap only relays WMS, WFS and WMTS: the request is sent as
     * SERVICE=WMS and renamed into the PROFILE service by the plugin.
     * @param {string} request - 'GetElevationLayers' or 'GetElevationProfile'
     * @param {object} [params] - Other parameters of the request
     * @returns {Promise<object>} The JSON response of the plugin
     */
    _profileServiceRequest(request, params = {}) {
        return Utils.fetchJSON(globalThis['lizUrls'].wms, {
            method: 'POST',
            body: new URLSearchParams({
                repository: globalThis['lizUrls'].params.repository,
                project: globalThis['lizUrls'].params.project,
                SERVICE: 'WMS',
                VERSION: '1.3.0',
                REQUEST: request,
                ...params,
            }),
        });
    }

    // =====================================================
    // ELEVATION LAYERS
    // =====================================================

    /**
     * Tells the component that the tool can't be used (no elevation layer
     * available).
     */
    _unavailable() {
        /**
         * No elevation layer available: the tool should be closed.
         * @event ElevationProfile#measures.profile.unavailable
         * @property {string} type measures.profile.unavailable
         */
        mainEventDispatcher.dispatch('measures.profile.unavailable');
    }

    /**
     * Loads the elevation layers from QGIS Server (the layers the user may
     * read, in the order of the QGIS layer tree, including the layers
     * hidden from the Lizmap legend), checks those shown by default, then
     * starts drawing.
     */
    async _loadLayers() {
        this._layers = [];
        this._visibleIds.clear();

        this._removeMessage(MESSAGE_ID);
        this._removeMessage(NO_LAYER_MESSAGE_ID);
        this._removeMessage(NO_DATA_MESSAGE_ID);

        let data;

        try {
            data = await this._profileServiceRequest('GetElevationLayers');
        } catch (error) {
            console.error('Elevation profile: error while retrieving the elevation layers', error);

            if (this._active) {
                this._addMessage(lizDict['measures.profile.error.demlist'], 'error', MESSAGE_ID);
            }

            return;
        }

        // The tool was closed meanwhile.
        if (!this._active) {
            return;
        }

        // Layers without id come from version 1 of the QGIS Server plugin,
        // which can't compute a profile of several layers.
        const layers = (data?.layers || []).filter((layer) => layer.id);

        // Project layers first, in the layer tree order, then the online
        // sources.
        this._layers = [
            ...layers.filter((layer) => layer.source !== 'online'),
            ...layers.filter((layer) => layer.source === 'online'),
        ];

        if (this._layers.length === 0) {
            this._addMessage(lizDict['measures.profile.error.nodem'], 'warning', NO_LAYER_MESSAGE_ID);

            this._unavailable();

            return;
        }

        this._layers.filter((layer) => layer.default_visible).forEach((layer) => this._visibleIds.add(layer.id));

        // Nothing shown by default in QGIS: the first layer is checked, so
        // that a line gives a profile right away.
        if (this._visibleIds.size === 0) {
            this._visibleIds.add(this._layers[0].id);
        }

        this._dispatchLayersChanged();

        this._startDrawing();
    }

    // =====================================================
    // DRAWING
    // =====================================================

    _startDrawing() {
        if (!this._draw) {
            this._setupLayers();
            this._setupDrawInteraction();

            this._map.on('pointerdrag', this._onPointerDrag);
            this._map.on('pointermove', this._onPointerMove);
            this._map.on('click', this._onClick);
            this._map.getViewport().addEventListener('pointerleave', this._onPointerLeave);
        }

        // Already drawn lines stay on the map (several lines can coexist).
        if (!this._map.getInteractions().getArray().includes(this._draw)) {
            this._map.addInteraction(this._draw);
        }
    }

    _setupLayers() {
        this._vectorSource = new VectorSource();

        // Hovered inactive line: same stroke with a white halo behind it
        // (look shared by all the measure tools, see Styles.js).
        this._vector = new VectorLayer({
            source: this._vectorSource,
            properties: { linedrawer: true },
            style: (feature) => [
                ...(feature === this._hoveredInactiveLine ? lineHoverStyle : [lineStyle]),
                ...this._lengthStyles(feature.getGeometry().getCoordinates()),
            ],
        });

        // Always shows a small circle at every vertex of the active line,
        // mirroring the node markers of the graph.
        this._nodesLayer = new VectorLayer({
            source: new VectorSource(),
            zIndex: 9998,
            visible: this._nodesVisible,
            style: nodeStyle,
        });

        // Marker shown while hovering the graph; same colors as Modify's
        // vertex style, so both directions stay visually consistent.
        this._graphHoverMarkerLayer = new VectorLayer({
            source: new VectorSource(),
            zIndex: 9999,
            style: vertexStyle,
        });

        this._map.addToolLayer(this._vector);
        this._map.addToolLayer(this._nodesLayer);
        this._map.addToolLayer(this._graphHoverMarkerLayer);
    }

    _refreshNodesLayer(coords) {
        if (!this._nodesLayer) {
            return;
        }

        const source = this._nodesLayer.getSource();

        source.clear();

        (coords || []).forEach((c) => {
            source.addFeature(new Feature({ geometry: new Point(c) }));
        });
    }

    _setupDrawInteraction() {
        this._draw = new Draw({
            source: this._vectorSource,
            type: 'LineString',
            // The draw tool stays armed: a click on an existing line or node
            // is left to selection / Modify. While drawing, every click goes
            // through.
            condition: (evt) => {
                if (this._isModifyingVertex) {
                    return false;
                }

                if (this._isDrawingLine) {
                    return true;
                }

                return !this._isNearLineOrNode(evt.pixel);
            },
            // No square icon near an existing line/node, where a new line
            // can't start (see the condition above).
            style: (feature) => this._sketchStyles(feature),
        });

        this._draw.on('drawstart', () => {
            // A data-less line pending deletion is erased right away.
            this._deletePendingEmptyLine();

            this._isDrawingLine = true;

            // No line edition while a new one is drawn.
            this._removeModifyInteraction();

            // Clears the profile, not the lines already drawn.
            this._clearProfile();

            this._hoverEnabledFeature = null;
        });

        // Escape, or Backspace down to the first point.
        this._draw.on('drawabort', () => {
            this._isDrawingLine = false;

            this._setupModifyInteraction();
        });

        this._draw.on('drawend', (evt) => {
            this._isDrawingLine = false;

            // A line that was just drawn is active and hoverable.
            this._activateLine(evt.feature, evt.feature.getGeometry().getCoordinates());

            this._setupModifyInteraction();
        });
    }

    /**
     * Length (m) of each segment of a line, measured like the distances of
     * the profile: in the map projection when it is a metric one other
     * than Pseudo-Mercator (like QGIS Desktop's profile), else on the
     * WGS84 ellipsoid. The total is thus the length of the graph.
     * @param {number[][]} coords - Vertices
     * @returns {number[]} Lengths
     */
    _segmentLengths(coords) {
        const projection = this._map.getView().getProjection();
        const metric = isMetricProjection(projection);
        const lengths = [];

        for (let i = 0; i < coords.length - 1; i++) {
            const a = coords[i];
            const b = coords[i + 1];

            lengths.push(metric
                ? Math.hypot(b[0] - a[0], b[1] - a[1])
                : inverse(transform(a, projection, 'EPSG:4326'), transform(b, projection, 'EPSG:4326')).distance);
        }

        return lengths;
    }

    /**
     * Length labels of a line.
     * @param {number[][]} coords - Vertices
     * @returns {object[]} Styles
     */
    _lengthStyles(coords) {
        return lineLengthStyles(coords, this._segmentLengths(coords), getSettings().segments);
    }

    /**
     * Help next to the pointer: what a click, a drag or Backspace would do.
     * @returns {string} Text
     */
    _tip() {
        if (this._isDrawingLine) {
            return lizDict['measures.measure.tip.continue'];
        }

        if (this._hoveredVertexCoord) {
            return lizDict[this._lastCoords && this._lastCoords.length > 2
                ? 'measures.measure.tip.vertex'
                : 'measures.measure.tip.vertexFixed'];
        }

        if (this._hoverInsertCoord) {
            return lizDict['measures.measure.tip.segment'];
        }

        if (this._hoveredInactiveLine) {
            return lizDict['measures.measure.tip.select'];
        }

        if (this._hoveredLine) {
            return lizDict['measures.measure.tip.active'];
        }

        return lizDict['measures.profile.tip.start'];
    }

    /**
     * Styles of the line being drawn and of the point under the pointer.
     * @param {object} feature - Sketch feature
     * @returns {object[]} Styles
     */
    _sketchStyles(feature) {
        const geometry = feature.getGeometry();

        if (geometry.getType() !== 'Point') {
            return [drawStyleNoPointer, ...this._lengthStyles(geometry.getCoordinates())];
        }

        // Nothing while a node is dragged (the point doesn't follow).
        if (this._isModifyingVertex) {
            return [];
        }

        const styles = [];

        // No square near an existing line or node, where a new line can't
        // start (see the condition of Draw).
        if (this._isDrawingLine || !this._nearSnapTarget) {
            styles.push(drawStyle);
        }

        if (getSettings().tips) {
            styles.push(tipStyle(this._tip()));
        }

        return styles;
    }

    // =====================================================
    // MAP EVENTS
    // =====================================================

    // Keeps the node dots in sync while a node is dragged (Modify only
    // fires modifyend on release).
    _handlePointerDrag() {
        if (!this._isModifyingVertex || !this._activeLine) {
            return;
        }

        this._refreshNodesLayer(this._activeLine.getGeometry().getCoordinates());
    }

    // Follows the cursor along the active line (moves the cursor of the
    // graph) and highlights hovered inactive lines.
    _handlePointerMove(evt) {
        if (evt.dragging) {
            return;
        }

        // About 30 hit-tests per second at most. The last position is
        // always handled (a bit later), so that the hover state matches
        // where the pointer stopped (Backspace acts on what is hovered).
        const now = performance.now();
        const wait = 32 - (now - this._lastPointerMoveHitTestTime);

        clearTimeout(this._pointerMoveTimer);

        if (wait > 0) {
            this._pointerMoveTimer = setTimeout(() => this._handlePointerMove(evt), wait);

            return;
        }

        this._lastPointerMoveHitTestTime = now;

        this._nearSnapTarget = !this._isDrawingLine && this._isNearLineOrNode(evt.pixel);

        const hoveredFeature =
            !this._isDrawingLine && !this._isModifyingVertex
                ? this._map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
                    layerFilter: (layer) => layer === this._vector,
                    hitTolerance: 10,
                })
                : null;

        this._hoveredLine = hoveredFeature || null;

        const hoveredInactiveLine = hoveredFeature && hoveredFeature !== this._activeLine ? hoveredFeature : null;

        if (hoveredInactiveLine !== this._hoveredInactiveLine) {
            this._hoveredInactiveLine = hoveredInactiveLine;

            this._vector.changed();
        }

        if (
            !this._activeLine ||
            this._hoverEnabledFeature !== this._activeLine ||
            this._isDrawingLine ||
            this._isModifyingVertex
        ) {
            this._hideExploreMarker();

            this._setCursor(this._hoveredInactiveLine ? 'pointer' : '');

            return;
        }

        // Close to the active line only because another (inactive) line
        // passes nearby.
        if (hoveredFeature && hoveredFeature !== this._activeLine) {
            this._hideExploreMarker();

            this._setCursor('pointer');

            return;
        }

        const closest = this._activeLine.getGeometry().getClosestPoint(evt.coordinate);
        const closestPixel = this._map.getPixelFromCoordinate(closest);

        if (Math.hypot(closestPixel[0] - evt.pixel[0], closestPixel[1] - evt.pixel[1]) > 10) {
            this._hideExploreMarker();

            return;
        }

        // Next to an existing node: Modify handles moving it; the node grows
        // on hover and can be deleted with Backspace.
        const nearestVertex = this._findNearestVertexCoord(evt.pixel);
        const previous = this._hoveredVertexCoord;

        this._hoverNearVertex = !!nearestVertex;
        this._hoveredVertexCoord = nearestVertex;

        // The hovered node's enlargement is Modify's style: forces a render
        // when this hover state changes.
        if (
            (nearestVertex ? nearestVertex[0] : null) !== (previous ? previous[0] : null) ||
            (nearestVertex ? nearestVertex[1] : null) !== (previous ? previous[1] : null)
        ) {
            this._map.render();
        }

        this._hoverInsertCoord = nearestVertex ? null : closest;

        this._setHoverIndex(this._closestSampleIndex(closest));

        this._setCursor(nearestVertex ? '' : 'copy');
    }

    // Click: inserts a node on the active line, or selects a line. Starting
    // a new line on empty map space is handled by Draw.
    _handleClick(evt) {
        if (this._isDrawingLine || this._isModifyingVertex) {
            return;
        }

        if (this._hoverInsertCoord && !this._hoverNearVertex) {
            this._insertVertexAt(this._hoverInsertCoord);

            return;
        }

        const clickedFeature = this._map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
            layerFilter: (layer) => layer === this._vector,
            hitTolerance: 8,
        });

        if (clickedFeature) {
            this._selectLine(clickedFeature);
        }
    }

    /**
     * Escape: cancels the line being drawn. Backspace or Delete: while
     * drawing, removes the last point; else deletes the hovered node (a
     * line keeps at least two), or the hovered line. Ignored while typing
     * in a form field.
     * @param {Event} evt - Keyboard event
     */
    _handleKeyDown(evt) {
        if (isTypingTarget(evt.target) || isTypingTarget(document.activeElement)) {
            return;
        }

        if (evt.key === 'Escape') {
            if (this._isDrawingLine && this._draw) {
                evt.preventDefault();

                this._draw.abortDrawing();
            }

            return;
        }

        if (evt.key !== 'Backspace' && evt.key !== 'Delete') {
            return;
        }

        if (this._isDrawingLine && this._draw) {
            evt.preventDefault();

            this._draw.removeLastPoint();

            return;
        }

        if (this._hoveredVertexCoord && this._lastCoords && this._lastCoords.length > 2) {
            evt.preventDefault();

            this._deleteHoveredVertex();

            return;
        }

        if (this._hoveredLine) {
            evt.preventDefault();

            this._deleteLine(this._hoveredLine);
        }
    }

    // The pointer left the map: nothing is hovered any more (Backspace
    // must not delete a line that is no longer under the pointer).
    _handlePointerLeave() {
        clearTimeout(this._pointerMoveTimer);

        this._hoveredLine = null;

        if (this._hoveredInactiveLine) {
            this._hoveredInactiveLine = null;

            this._vector?.changed();
        }

        this._hideExploreMarker();
    }

    /**
     * Deletes a line; if it is the active one, its profile is cleared.
     * @param {object} feature - Line
     */
    _deleteLine(feature) {
        if (feature === this._pendingEmptyLineFeature) {
            this._deletePendingEmptyLine();

            return;
        }

        if (feature === this._activeLine) {
            this._hideExploreMarker();

            this._setModifyTarget(null);

            this._hoverEnabledFeature = null;

            this._clearProfile();
        }

        this._hoveredLine = null;

        if (this._hoveredInactiveLine === feature) {
            this._hoveredInactiveLine = null;
        }

        if (this._vectorSource?.hasFeature(feature)) {
            this._vectorSource.removeFeature(feature);
        }

        this._setCursor('');
    }

    /**
     * Index of the profile sample closest to a map coordinate, or null.
     * @param {number[]} coord - Map coordinate
     * @returns {number|null} Index in the profile samples
     */
    _closestSampleIndex(coord) {
        if (!this._profile) {
            return null;
        }

        let bestIndex = 0;
        let bestDist = Infinity;

        this._profile.coords.forEach((c, idx) => {
            const d = (c[0] - coord[0]) ** 2 + (c[1] - coord[1]) ** 2;

            if (d < bestDist) {
                bestDist = d;
                bestIndex = idx;
            }
        });

        return bestIndex;
    }

    // Vertex of the active line closest to the pixel (10px tolerance).
    _findNearestVertexCoord(pixel) {
        if (!this._lastCoords) {
            return null;
        }

        let best = null;
        let bestDist = Infinity;

        this._lastCoords.forEach((c) => {
            const p = this._map.getPixelFromCoordinate(c);
            const dist = Math.hypot(p[0] - pixel[0], p[1] - pixel[1]);

            if (dist < 10 && dist < bestDist) {
                bestDist = dist;
                best = c;
            }
        });

        return best;
    }

    _isNearLineOrNode(pixel) {
        return !!this._map.forEachFeatureAtPixel(pixel, (f) => f, {
            layerFilter: (layer) => layer === this._vector || layer === this._nodesLayer,
            hitTolerance: 10,
        });
    }

    _hideExploreMarker() {
        this._hoverInsertCoord = null;
        this._hoverNearVertex = false;

        // The enlarged (hovered) node goes back to its normal size.
        if (this._hoveredVertexCoord) {
            this._map.render();
        }

        this._hoveredVertexCoord = null;

        this._setCursor('');

        this._setHoverIndex(null);
    }

    // =====================================================
    // EDITING THE ACTIVE LINE
    // =====================================================

    _setupModifyInteraction() {
        if (this._modify || !this._vectorSource) {
            return;
        }

        // Only the active line is modifiable: a dedicated source holding just
        // that line (see _setModifyTarget).
        this._modifySource = new VectorSource();

        if (this._activeLine) {
            this._modifySource.addFeature(this._activeLine);
        }

        this._modify = new Modify({
            source: this._modifySource,
            pixelTolerance: 12,
            style: (feature) => {
                const coord = feature.getGeometry().getCoordinates();
                const hovered = this._hoveredVertexCoord;

                return hovered && coord[0] === hovered[0] && coord[1] === hovered[1]
                    ? hoveredVertexStyle
                    : vertexStyle;
            },
        });

        this._modify.on('modifystart', () => {
            this._isModifyingVertex = true;

            this._hideExploreMarker();
        });

        this._modify.on('modifyend', (evt) => {
            this._isModifyingVertex = false;

            const feature = evt.features.getArray()[0];
            const coords = feature ? feature.getGeometry().getCoordinates() : null;

            // The modified line becomes active (and hoverable).
            if (coords && coords.length >= 2) {
                this._activateLine(feature, coords);
            }
        });

        this._map.addInteraction(this._modify);
    }

    _removeModifyInteraction() {
        if (this._modify) {
            this._map.removeInteraction(this._modify);
        }

        this._modify = null;
        this._modifySource = null;
    }

    _setModifyTarget(feature) {
        if (!this._modifySource) {
            return;
        }

        this._modifySource.clear();

        if (feature) {
            this._modifySource.addFeature(feature);
        }
    }

    /**
     * Makes a line the active one and requests its profile.
     * @param {object} feature - Line feature
     * @param {number[][]} coords - Its coordinates
     */
    _activateLine(feature, coords) {
        this._clearProfile();

        this._lastCoords = coords;
        this._activeLine = feature;
        this._hoverEnabledFeature = feature;

        this._refreshNodesLayer(coords);

        this._requestProfile(coords);
    }

    // A click on a line makes it active; Modify is retargeted onto it.
    _selectLine(feature) {
        this._hoverEnabledFeature = feature;

        this._setModifyTarget(feature);

        if (feature === this._activeLine) {
            return;
        }

        this._hideExploreMarker();

        this._activateLine(feature, feature.getGeometry().getCoordinates());
    }

    _distanceToSegment(p, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const lengthSquared = dx * dx + dy * dy;

        if (lengthSquared === 0) {
            return Math.hypot(p[0] - a[0], p[1] - a[1]);
        }

        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));

        return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    }

    _insertVertexAt(coord) {
        if (!this._activeLine || !this._lastCoords) {
            return;
        }

        let bestIndex = 0;
        let bestDist = Infinity;

        for (let i = 0; i < this._lastCoords.length - 1; i++) {
            const d = this._distanceToSegment(coord, this._lastCoords[i], this._lastCoords[i + 1]);

            if (d < bestDist) {
                bestDist = d;
                bestIndex = i;
            }
        }

        const newCoords = this._lastCoords.slice();

        newCoords.splice(bestIndex + 1, 0, coord);

        this._setActiveLineCoords(newCoords);
    }

    // A line keeps at least two vertices.
    _deleteHoveredVertex() {
        const hovered = this._hoveredVertexCoord;

        if (!hovered || !this._activeLine || !this._lastCoords || this._lastCoords.length <= 2) {
            return;
        }

        const index = this._lastCoords.findIndex((c) => c[0] === hovered[0] && c[1] === hovered[1]);

        if (index === -1) {
            return;
        }

        const newCoords = this._lastCoords.slice();

        newCoords.splice(index, 1);

        this._setActiveLineCoords(newCoords);
    }

    _setActiveLineCoords(newCoords) {
        const feature = this._activeLine;

        feature.getGeometry().setCoordinates(newCoords);

        this._hideExploreMarker();

        this._activateLine(feature, newCoords);
    }

    // =====================================================
    // PROFILE
    // =====================================================

    _clearProfile() {
        // Invalidates any pending profile request.
        this._profileRequestId++;

        const hadLine = !!this._lastCoords;

        this._lastCoords = null;

        this._setLoading([]);
        this._activeLine = null;

        this._refreshNodesLayer(null);

        this.hideMarker();

        this._setHoverIndex(null);

        // Also when only the line is removed: the display shows the drawing
        // hint again.
        if (this._profile || hadLine) {
            this._profile = null;

            this._dispatchProfileChanged();
        }
    }

    /**
     * Sets the layers whose profile is being computed (spinner in the
     * layer tree).
     * @param {string[]} ids - Layer ids
     */
    _setLoading(ids) {
        const changed = ids.length !== this._loadingIds.size || ids.some((id) => !this._loadingIds.has(id));

        if (!changed) {
            return;
        }

        this._loadingIds = new Set(ids);

        this._dispatchLayersChanged();
    }

    /**
     * Requests the profile of the checked layers along a line; the
     * coordinates are sent in the projection of the map.
     *
     * The layers of the project are requested first and displayed as soon
     * as they arrive. The online sources (Copernicus), much slower (read on
     * the Internet by QGIS Server), come in a second request at the same
     * points (SAMPLES = number of points of the first answer) and are added
     * to the graph when they arrive.
     *
     * Only what is missing is requested. A newly checked project layer may
     * change the sampling step: all the checked layers are then requested
     * again.
     * @param {number[][]} coords - Coordinates of the line
     */
    async _requestProfile(coords) {
        const visible = this._layers.filter((layer) => this._visibleIds.has(layer.id));

        if (visible.length === 0) {
            return;
        }

        const projectIds = visible.filter((layer) => layer.source !== 'online').map((layer) => layer.id);
        const onlineIds = visible.filter((layer) => layer.source === 'online').map((layer) => layer.id);

        const refresh = !this._profile || projectIds.some((id) => !this._profile.values.has(id));

        const requestId = ++this._profileRequestId;
        const geometry = coords.map((c) => `${c[0]},${c[1]}`).join(';');

        this._removeMessage(MESSAGE_ID);

        if (refresh && projectIds.length > 0) {
            this._setLoading([...projectIds, ...onlineIds]);

            const data = await this._fetchProfile(requestId, geometry, projectIds);

            if (!data) {
                return;
            }

            this._setProfile(data);

            if (onlineIds.length === 0) {
                this._setLoading([]);
                this._finishProfile();

                return;
            }

            // Project layers displayed right away; the online sources follow.
            this._setLoading(onlineIds);
            this._dispatchProfileChanged();
        }

        const missing = refresh && projectIds.length === 0
            ? onlineIds
            : onlineIds.filter((id) => !this._profile?.values.has(id));

        if (missing.length === 0) {
            this._setLoading([]);
            this._dispatchProfileChanged();

            return;
        }

        this._setLoading(missing);

        const samples = this._profile && !(refresh && projectIds.length === 0) ? this._profile.x.length : null;

        const data = await this._fetchProfile(requestId, geometry, missing, samples);

        if (!data) {
            return;
        }

        if (samples && this._profile && data.x.length === this._profile.x.length) {
            (data.profiles || []).forEach((profile) => this._profile.values.set(profile.id, profile.y));
        } else {
            this._setProfile(data);
        }

        this._setLoading([]);
        this._finishProfile();
    }

    /**
     * Sends a GetElevationProfile request.
     * @param {number} requestId - Id of the profile request; its answer is dropped if it is outdated
     * @param {string} geometry - GEOMETRY parameter
     * @param {string[]} ids - Layer ids
     * @param {number|null} [samples] - Number of points (SAMPLES), to get the points of a previous answer
     * @returns {Promise<object|null>} The answer, or null (error, or outdated request)
     */
    async _fetchProfile(requestId, geometry, ids, samples = null) {
        const params = {
            GEOMETRY: geometry,
            LAYERS: ids.join(','),
            CRS: this._map.getView().getProjection().getCode(),
        };

        if (samples) {
            params.SAMPLES = String(samples);
        }

        try {
            const data = await this._profileServiceRequest('GetElevationProfile', params);

            // A newer request (or a cleanup) made this one obsolete.
            return requestId === this._profileRequestId ? data : null;
        } catch (error) {
            if (requestId === this._profileRequestId) {
                console.error('Elevation profile: request error', error);

                this._setLoading([]);

                if (this._active) {
                    this._addMessage(lizDict['measures.profile.error.request'], 'error', MESSAGE_ID);
                }

                // The curves already received stay displayed.
                if (this._profile) {
                    this._finishProfile();
                }
            }

            return null;
        }
    }

    /**
     * Replaces the profile of the active line by an answer of the server.
     * @param {object} data - Answer of GetElevationProfile
     */
    _setProfile(data) {
        this._removeMessage(NO_DATA_MESSAGE_ID);

        this._setHoverIndex(null);

        this._profile = {
            x: data.x,
            coords: data.coords,
            vertices: data.vertices || [],
            values: new Map((data.profiles || []).map((profile) => [profile.id, profile.y])),
        };
    }

    /**
     * All the requested profiles arrived: draws them, or, if no layer has
     * data under the line, removes the line.
     */
    _finishProfile() {
        const hasData = [...this._profile.values.values()].some((y) => y.some((v) => v != null && !isNaN(v)));

        if (!hasData) {
            this._profile = null;

            this._dispatchProfileChanged();

            this._handleEmptyProfile();

            return;
        }

        this._dispatchProfileChanged();
    }

    // No elevation data under the line: temporary message, then the line
    // is deleted (right away if the message is closed or a new line is
    // started).
    _handleEmptyProfile() {
        this._deletePendingEmptyLine();

        this._pendingEmptyLineFeature = this._activeLine;

        const messageElement = this._addMessage(
            lizDict['measures.profile.error.nodata'],
            'warning',
            NO_DATA_MESSAGE_ID,
        );

        this._pendingEmptyLineTimer = setTimeout(() => this._deletePendingEmptyLine(), 2000);

        if (messageElement) {
            this._pendingEmptyLineMessageObserver = new MutationObserver(() => {
                if (!document.body.contains(messageElement)) {
                    this._deletePendingEmptyLine();
                }
            });

            this._pendingEmptyLineMessageObserver.observe(messageElement.parentNode || document.body, {
                childList: true,
                subtree: true,
            });
        }
    }

    _deletePendingEmptyLine() {
        if (this._pendingEmptyLineTimer) {
            clearTimeout(this._pendingEmptyLineTimer);
            this._pendingEmptyLineTimer = null;
        }

        if (this._pendingEmptyLineMessageObserver) {
            this._pendingEmptyLineMessageObserver.disconnect();
            this._pendingEmptyLineMessageObserver = null;
        }

        if (!this._pendingEmptyLineFeature) {
            return;
        }

        const feature = this._pendingEmptyLineFeature;

        this._pendingEmptyLineFeature = null;

        this._removeMessage(NO_DATA_MESSAGE_ID);

        if (this._activeLine === feature) {
            this._hideExploreMarker();

            this._setModifyTarget(null);

            this._hoverEnabledFeature = null;

            this._clearProfile();
        }

        if (this._vectorSource?.hasFeature(feature)) {
            this._vectorSource.removeFeature(feature);
        }
    }

    // =====================================================
    // LIZMAP POPUP ON/OFF
    // =====================================================
    //
    // The identify popup opens on any click on the map while its `active`
    // flag is true: it is disabled while the tool is active, and restored to
    // its previous value afterwards.

    _setPopupEnabled(enabled) {
        const popup = mainLizmap.popup;

        if (!popup) {
            return;
        }

        if (!enabled) {
            if (this._popupActiveBefore === null) {
                this._popupActiveBefore = popup.active;
            }

            popup.active = false;
        } else {
            popup.active = this._popupActiveBefore !== null ? this._popupActiveBefore : true;

            this._popupActiveBefore = null;
        }
    }
}
