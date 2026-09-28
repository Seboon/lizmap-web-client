/**
 * @module modules/measures/Measure.js
 * @name Measure
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../Globals.js';
import { inverse, isMetricProjection, normalizeDegrees, polygonArea } from './Geodesy.js';
import { isTypingTarget } from './Keyboard.js';
import {
    formatAngle,
    formatArea,
    formatLength,
    formatNumber,
    mainLabelStyle,
    segmentLabelStyle,
    tipStyle,
} from './Labels.js';
import { getSettings, setSetting } from './Settings.js';
import {
    areaFill,
    drawStyle,
    drawStyleNoPointer,
    hoveredVertexStyle,
    lineHaloStyle,
    lineStyle,
    nodeStyle,
    vertexStyle,
} from './Styles.js';
import { altKeyOnly, always, never, singleClick } from 'ol/events/condition.js';
import LineString from 'ol/geom/LineString.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import VectorLayer from 'ol/layer/Vector.js';
import { transform } from 'ol/proj.js';
import VectorSource from 'ol/source/Vector.js';
import { Style } from 'ol/style.js';

/**
 * Tools of the module, and the geometry each one draws.
 * @type {{[tool: string]: {type: string, minPoints?: number, maxPoints?: number, insertable: boolean, removableVertices: number}}}
 */
const TOOLS = {
    // removableVertices: fewest vertices a measure keeps when one is
    // deleted (Infinity: the number of vertices is fixed).
    length: { type: 'LineString', insertable: true, removableVertices: 2 },
    area: { type: 'Polygon', insertable: true, removableVertices: 3 },
    angle: { type: 'LineString', minPoints: 3, maxPoints: 3, insertable: false, removableVertices: Infinity },
    bearing: { type: 'LineString', minPoints: 2, maxPoints: 2, insertable: false, removableVertices: Infinity },
};

// Distance (px) under which the pointer is on a line or a vertex.
const HIT_TOLERANCE = 10;

const areaStyle = new Style({ fill: areaFill, stroke: lineStyle.getStroke() });

/**
 * Measure of a geometry.
 * @typedef {object} MeasureResult
 * @property {string}        tool        'length', 'area', 'angle' or 'bearing'
 * @property {number[]}      segments    Length (m) of each segment
 * @property {number}        [total]     Length (m) of the line (length)
 * @property {number}        [area]      Area (m²) (area)
 * @property {number}        [perimeter] Perimeter (m) (area)
 * @property {number|null}   [angle]     Angle (degrees, 0 to 180) at the middle vertex (angle)
 * @property {number}        [distance]  Distance (m) (bearing)
 * @property {number}        [azimuth]   Azimuth from the geographic north (degrees) (bearing)
 * @property {number|null}   [gridBearing] Bearing from the north of the grid of the map projection (degrees), when the projection is a metric one other than Pseudo-Mercator (bearing)
 * @property {boolean}       cartesian   Lengths and area computed in the map projection (else on the ellipsoid)
 */

/**
 * Measure tools of the "Measure" menu: length, area, angle and bearing,
 * drawn on the map with OpenLayers, with the same look and the same
 * editing as the lines of the elevation profile:
 * - click to add a point, double-click to finish (angle: 3 points,
 *   bearing: 2 points, finished automatically);
 * - several measures can coexist; the active one (the last one drawn, or
 *   the one clicked) shows its nodes and can be edited: drag a node,
 *   click on the line to insert a node (length and area);
 * - Escape cancels the measure being drawn, Backspace removes its last
 *   point; on a hovered node, Backspace deletes the node, on a hovered
 *   measure, it deletes the measure;
 * - a help next to the pointer tells what a click, a drag or Backspace
 *   would do (it can be hidden, see Settings.js).
 *
 * Lengths and areas are computed on the WGS84 ellipsoid, like QGIS
 * Desktop, or, if chosen, in the projection of the map when it is a
 * metric one (e.g. Lambert-93; not Pseudo-Mercator, whose distances are
 * strongly stretched). Angles and azimuths are always computed on the
 * ellipsoid.
 *
 * The measures are shown on the map (labels) and, in detail, by the
 * <lizmap-measure-panel> component, which listens to its events.
 * @class
 * @name Measure
 * @fires Measure#measures.measure.changed
 */
export default class Measure {
    /**
     * Create the module; nothing is added to the map before activate().
     * @param {object} map - The Lizmap map (modules/map.js)
     */
    constructor(map) {
        this._map = map;

        this._tool = null;


        this._source = null;
        this._layer = null;
        this._draw = null;
        this._modify = null;
        this._modifySource = null;

        // Measure being drawn (Draw sketch), and active measure.
        this._sketch = null;
        this._activeFeature = null;

        // Hovered measure, hovered node of the active measure, and point of
        // the active measure where a click inserts a node.
        this._hoveredFeature = null;
        this._hoveredVertex = null;
        this._insertCoord = null;

        this._isDrawing = false;
        this._isModifying = false;

        this._popupActiveBefore = null;

        this._changeFrame = null;

        this._onPointerMove = (evt) => this._handlePointerMove(evt);
        this._onClick = (evt) => this._handleClick(evt);
        this._onKeyDown = (evt) => this._handleKeyDown(evt);
        this._onSketchChange = () => this._dispatchChangedSoon();

        // The pointer left the map: nothing is hovered any more (Backspace
        // must not delete a measure that is no longer under the pointer).
        this._onPointerLeave = () => this._clearHover();

        // Display settings changed (also from the elevation profile).
        this._onSettingsChanged = () => {
            this._layer?.changed();
            this._draw?.getOverlay().changed();

            this._dispatchChanged();
        };
    }

    // =====================================================
    // STATE
    // =====================================================

    /**
     * Active tool ('length', 'area', 'angle', 'bearing'), or null.
     * @type {string|null}
     */
    get tool() {
        return this._tool;
    }

    /**
     * Settings of the tools, remembered in the browser.
     * @type {{segments: boolean, calc: string, angleUnit: string}}
     */
    get settings() {
        return getSettings();
    }

    /**
     * Lengths and areas can be computed in the projection of the map: it
     * is a metric projection other than Pseudo-Mercator.
     * @type {boolean}
     */
    get cartesianAvailable() {
        return isMetricProjection(this._map.getView().getProjection());
    }

    /**
     * Code of the projection of the map (e.g. 'EPSG:2154').
     * @type {string}
     */
    get projectionCode() {
        return this._map.getView().getProjection().getCode();
    }

    /**
     * Number of measures on the map.
     * @type {number}
     */
    get count() {
        return this._source ? this._source.getFeatures().length : 0;
    }

    /**
     * The user is drawing a measure.
     * @type {boolean}
     */
    get drawing() {
        return this._isDrawing;
    }

    /**
     * Measure being drawn, else the active measure, or null.
     * @returns {MeasureResult|null} Measure
     */
    currentResult() {
        const feature = this._sketch || this._activeFeature;

        return feature ? this.measure(feature.getGeometry()) : null;
    }

    /**
     * Changes a setting: segments (show the length of the segments), tips
     * (show the help next to the pointer), calc ('ellipsoidal' or
     * 'cartesian'), angleUnit ('deg' or 'gon'). Shared with the elevation
     * profile, remembered in the browser.
     * @param {string} name - Setting
     * @param {boolean|string} value - Value
     */
    setSetting(name, value) {
        setSetting(name, value);
    }

    // =====================================================
    // ACTIVATE / DEACTIVATE
    // =====================================================

    /**
     * Activates a tool (another active tool is closed first, with its
     * measures).
     * @param {string} tool - 'length', 'area', 'angle' or 'bearing'
     */
    activate(tool) {
        if (!TOOLS[tool] || tool === this._tool) {
            return;
        }

        this.deactivate();

        this._tool = tool;

        this._setPopupEnabled(false);

        this._source = new VectorSource();
        this._layer = new VectorLayer({
            source: this._source,
            properties: { measure: true },
            style: (feature) => this._featureStyles(feature),
        });

        this._map.addToolLayer(this._layer);

        this._setupDraw();
        this._setupModify();

        this._map.on('pointermove', this._onPointerMove);
        this._map.on('click', this._onClick);
        this._map.getViewport().addEventListener('pointerleave', this._onPointerLeave);
        document.addEventListener('keydown', this._onKeyDown);
        mainEventDispatcher.addListener(this._onSettingsChanged, 'measures.settings.changed');

        this._dispatchChanged();
    }

    /**
     * Deactivates the tool: removes its measures, layers and interactions,
     * and restores the Lizmap popup.
     */
    deactivate() {
        if (!this._tool) {
            return;
        }

        document.removeEventListener('keydown', this._onKeyDown);
        mainEventDispatcher.removeListener(this._onSettingsChanged, 'measures.settings.changed');
        this._map.un('pointermove', this._onPointerMove);
        this._map.un('click', this._onClick);
        this._map.getViewport().removeEventListener('pointerleave', this._onPointerLeave);

        this._sketch?.getGeometry()?.un('change', this._onSketchChange);

        [this._draw, this._modify].forEach((interaction) => {
            if (interaction) {
                this._map.removeInteraction(interaction);
            }
        });

        if (this._layer) {
            this._map.removeToolLayer(this._layer);
        }

        if (this._changeFrame) {
            cancelAnimationFrame(this._changeFrame);
            this._changeFrame = null;
        }

        this._draw = null;
        this._modify = null;
        this._modifySource = null;
        this._layer = null;
        this._source = null;
        this._sketch = null;
        this._activeFeature = null;
        this._hoveredFeature = null;
        this._hoveredVertex = null;
        this._insertCoord = null;
        this._isDrawing = false;
        this._isModifying = false;
        this._tool = null;

        this._setCursor('');

        this._setPopupEnabled(true);

        this._dispatchChanged();
    }

    /**
     * Removes all the measures (and the one being drawn).
     */
    clear() {
        if (!this._tool) {
            return;
        }

        this._draw?.abortDrawing();

        this._setActive(null);
        this._clearHover();
        this._source.clear();

        this._dispatchChanged();
    }

    // =====================================================
    // COMPUTATIONS
    // =====================================================

    /**
     * Vertices of a measure (for an area: its outer ring, without the
     * closing point).
     * @param {object} geometry - LineString or Polygon
     * @returns {number[][]} Vertices
     */
    _vertices(geometry) {
        if (geometry.getType() === 'Polygon') {
            const ring = geometry.getCoordinates()[0] || [];

            return ring.slice(0, -1);
        }

        return geometry.getCoordinates();
    }

    _setVertices(feature, vertices) {
        const geometry = feature.getGeometry();

        if (geometry.getType() === 'Polygon') {
            geometry.setCoordinates([[...vertices, vertices[0]]]);
        } else {
            geometry.setCoordinates(vertices);
        }
    }

    /**
     * Segments of a measure, as pairs of vertices (for an area, the
     * closing segment included).
     * @param {object} geometry - LineString or Polygon
     * @returns {Array<number[][]>} Segments
     */
    _segments(geometry) {
        const vertices = this._vertices(geometry);
        const segments = [];

        for (let i = 0; i < vertices.length - 1; i++) {
            segments.push([vertices[i], vertices[i + 1]]);
        }

        if (geometry.getType() === 'Polygon' && vertices.length > 2) {
            segments.push([vertices[vertices.length - 1], vertices[0]]);
        }

        return segments;
    }

    _toLonLat(coord) {
        return transform(coord, this._map.getView().getProjection(), 'EPSG:4326');
    }

    get _cartesian() {
        return getSettings().calc === 'cartesian' && this.cartesianAvailable;
    }

    /**
     * Length (m) of a segment.
     * @param {number[]} a - Start (map coordinates)
     * @param {number[]} b - End (map coordinates)
     * @returns {number} Length
     */
    _segmentLength(a, b) {
        if (this._cartesian) {
            return Math.hypot(b[0] - a[0], b[1] - a[1]);
        }

        return inverse(this._toLonLat(a), this._toLonLat(b)).distance;
    }

    /**
     * Measure of a geometry of the active tool.
     * @param {object} geometry - LineString or Polygon
     * @returns {MeasureResult} Measure
     */
    measure(geometry) {
        const tool = this._tool;
        const segments = this._segments(geometry).map(([a, b]) => this._segmentLength(a, b));
        const total = segments.reduce((sum, length) => sum + length, 0);
        const result = { tool, segments, cartesian: this._cartesian };

        if (tool === 'length') {
            result.total = total;
        } else if (tool === 'area') {
            const vertices = this._vertices(geometry);

            result.perimeter = total;
            result.area = 0;

            if (vertices.length > 2) {
                result.area = this._cartesian
                    ? Math.abs(geometry.getArea())
                    : polygonArea([[...vertices, vertices[0]].map((c) => this._toLonLat(c))]);
            }
        } else if (tool === 'angle') {
            const vertices = this._vertices(geometry);

            result.angle = null;

            if (vertices.length >= 3) {
                const center = this._toLonLat(vertices[1]);
                const first = inverse(center, this._toLonLat(vertices[0])).azimuth;
                const second = inverse(center, this._toLonLat(vertices[2])).azimuth;
                const difference = normalizeDegrees(second - first);

                result.angle = difference > 180 ? 360 - difference : difference;
            }
        } else if (tool === 'bearing') {
            const [a, b] = this._vertices(geometry);

            result.distance = total;
            result.azimuth = a && b ? inverse(this._toLonLat(a), this._toLonLat(b)).azimuth : 0;
            result.gridBearing = a && b && this.cartesianAvailable
                ? normalizeDegrees((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI)
                : null;
        }

        return result;
    }

    // =====================================================
    // FORMATTING
    // =====================================================

    /**
     * Formats a number in the language of the page.
     * @param {number} value - Number
     * @param {number} decimals - Decimals
     * @returns {string} Formatted number
     */
    static formatNumber(value, decimals) {
        return formatNumber(value, decimals);
    }

    /**
     * Formats a length: m under 1 km, else km.
     * @param {number} meters - Length (m)
     * @returns {string} Formatted length
     */
    static formatLength(meters) {
        return formatLength(meters);
    }

    /**
     * Formats an area: m² under 1 ha, ha under 1 km², else km².
     * @param {number} squareMeters - Area (m²)
     * @returns {string} Formatted area
     */
    static formatArea(squareMeters) {
        return formatArea(squareMeters);
    }

    /**
     * Formats an angle in degrees or in grades (gon).
     * @param {number} degrees - Angle (degrees)
     * @param {string} unit - 'deg' or 'gon'
     * @returns {string} Formatted angle
     */
    static formatAngle(degrees, unit) {
        return formatAngle(degrees, unit);
    }

    // =====================================================
    // STYLES
    // =====================================================

    /**
     * Main label of a measure, and where it is placed.
     * @param {object} geometry - LineString or Polygon
     * @param {MeasureResult} result - Its measure
     * @returns {{text: string, coord: number[]}|null} Label, or null
     */
    _mainLabel(geometry, result) {
        const vertices = this._vertices(geometry);
        const unit = getSettings().angleUnit;

        if (vertices.length < 2) {
            return null;
        }

        switch (result.tool) {
            case 'length':
                return { text: Measure.formatLength(result.total), coord: vertices[vertices.length - 1] };
            case 'area':
                if (vertices.length < 3) {
                    return null;
                }

                return { text: Measure.formatArea(result.area), coord: geometry.getInteriorPoint().getCoordinates().slice(0, 2) };
            case 'angle':
                if (result.angle === null) {
                    return null;
                }

                return { text: Measure.formatAngle(result.angle, unit), coord: vertices[1] };
            case 'bearing':
                return {
                    text: `${Measure.formatAngle(result.azimuth, unit)}\n${Measure.formatLength(result.distance)}`,
                    coord: vertices[vertices.length - 1],
                };
            default:
                return null;
        }
    }

    /**
     * Labels of a measure: its value and, if chosen, the length of its
     * segments.
     * @param {object} geometry - LineString or Polygon
     * @returns {Style[]} Styles
     */
    _labelStyles(geometry) {
        const result = this.measure(geometry);
        const styles = [];

        if (getSettings().segments && result.tool !== 'bearing') {
            const segments = this._segments(geometry);

            // A single segment: its length is the one of the line.
            const shown = result.tool === 'length' && segments.length < 2 ? [] : segments;

            // An area being drawn with 2 points: both segments are the same.
            if (!(result.tool === 'area' && this._vertices(geometry).length < 3)) {
                shown.forEach(([a, b], index) => {
                    if (result.segments[index] === 0) {
                        return;
                    }

                    styles.push(segmentLabelStyle(
                        Measure.formatLength(result.segments[index]),
                        [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
                    ));
                });
            }
        }

        const label = this._mainLabel(geometry, result);

        if (label) {
            styles.push(mainLabelStyle(label.text, label.coord));
        }

        return styles;
    }

    /**
     * Styles of a drawn measure.
     * @param {object} feature - Measure
     * @returns {Style[]} Styles
     */
    _featureStyles(feature) {
        const geometry = feature.getGeometry();
        const styles = [];
        const isArea = geometry.getType() === 'Polygon';

        // Hovered inactive measure: a halo shows that a click makes it
        // active.
        if (feature === this._hoveredFeature && feature !== this._activeFeature) {
            styles.push(isArea ? new Style({ stroke: lineHaloStyle.getStroke() }) : lineHaloStyle);
        }

        styles.push(isArea ? areaStyle : lineStyle);

        if (feature === this._activeFeature) {
            styles.push(new Style({ geometry: new MultiPoint(this._vertices(geometry)), image: nodeStyle.getImage() }));
        }

        return styles.concat(this._labelStyles(geometry));
    }

    /**
     * Help shown next to the pointer: what a click, a drag or Backspace
     * would do where the pointer is.
     * @returns {string} Text
     */
    _tip() {
        if (!this._isDrawing || !this._sketch) {
            return this._hoverTip() || lizDict['measures.measure.tip.start'];
        }

        // The last vertex of the sketch follows the pointer.
        const placed = this._vertices(this._sketch.getGeometry()).length - 1;

        if (this._tool === 'angle') {
            return lizDict[placed < 2 ? 'measures.measure.tip.angleVertex' : 'measures.measure.tip.angleEnd'];
        }

        if (this._tool === 'bearing') {
            return lizDict['measures.measure.tip.bearingEnd'];
        }

        return lizDict['measures.measure.tip.continue'];
    }

    /**
     * Help for what is under the pointer (a measure or one of its nodes),
     * or null.
     * @returns {string|null} Text
     */
    _hoverTip() {
        if (this._hoveredVertex && this._activeFeature) {
            const vertices = this._vertices(this._activeFeature.getGeometry());

            return lizDict[vertices.length > TOOLS[this._tool].removableVertices
                ? 'measures.measure.tip.vertex'
                : 'measures.measure.tip.vertexFixed'];
        }

        if (this._insertCoord) {
            return lizDict['measures.measure.tip.segment'];
        }

        if (this._hoveredFeature) {
            return lizDict[this._hoveredFeature === this._activeFeature
                ? 'measures.measure.tip.active'
                : 'measures.measure.tip.select'];
        }

        return null;
    }

    /**
     * Styles of the measure being drawn (Draw sketch).
     * @param {object} feature - Sketch feature (the geometry, or the point under the pointer)
     * @returns {Style[]} Styles
     */
    _sketchStyles(feature) {
        const geometry = feature.getGeometry();
        const type = geometry.getType();

        if (type === 'Point') {
            // Nothing while a node is dragged (the point doesn't follow).
            if (this._isModifying) {
                return [];
            }

            const styles = [];

            // No square near an existing measure, where a click selects it.
            if (this._isDrawing || !this._hoveredFeature) {
                styles.push(drawStyle);
            }

            if (getSettings().tips) {
                styles.push(tipStyle(this._tip()));
            }

            return styles;
        }

        // Line drawn along a polygon being drawn: the polygon has its own
        // outline.
        if (type !== TOOLS[this._tool].type) {
            return [];
        }

        return [type === 'Polygon' ? areaStyle : drawStyleNoPointer, ...this._labelStyles(geometry)];
    }

    // =====================================================
    // INTERACTIONS
    // =====================================================

    _setupDraw() {
        const definition = TOOLS[this._tool];

        this._draw = new Draw({
            source: this._source,
            type: definition.type,
            minPoints: definition.minPoints,
            maxPoints: definition.maxPoints,
            // A click on an existing measure selects it; while drawing,
            // every click goes through.
            condition: (evt) => {
                if (this._isModifying) {
                    return false;
                }

                return this._isDrawing || !this._featureAtPixel(evt.pixel);
            },
            style: (feature) => this._sketchStyles(feature),
        });

        this._draw.on('drawstart', (evt) => {
            this._isDrawing = true;
            this._sketch = evt.feature;
            this._sketch.getGeometry().on('change', this._onSketchChange);

            this._setActive(null);
            this._clearHover();

            this._dispatchChanged();
        });

        this._draw.on('drawend', (evt) => {
            this._endSketch();

            evt.feature.set('measureTool', this._tool);

            // Drawend is dispatched before the feature is added.
            this._source.once('addfeature', () => this._setActive(evt.feature));
        });

        this._draw.on('drawabort', () => {
            this._endSketch();

            this._dispatchChanged();
        });

        this._map.addInteraction(this._draw);
    }

    _endSketch() {
        this._sketch?.getGeometry()?.un('change', this._onSketchChange);
        this._sketch = null;
        this._isDrawing = false;
    }

    _setupModify() {
        const definition = TOOLS[this._tool];

        // Only the active measure can be modified: a dedicated source
        // holding just that measure (see _setActive).
        this._modifySource = new VectorSource();

        this._modify = new Modify({
            source: this._modifySource,
            pixelTolerance: 12,
            insertVertexCondition: definition.insertable ? always : never,
            deleteCondition: Number.isFinite(definition.removableVertices)
                ? (evt) => altKeyOnly(evt) && singleClick(evt)
                : never,
            style: (feature) => {
                const coord = feature.getGeometry().getCoordinates();
                const hovered = this._hoveredVertex;

                return hovered && coord[0] === hovered[0] && coord[1] === hovered[1] ? hoveredVertexStyle : vertexStyle;
            },
        });

        this._modify.on('modifystart', () => {
            this._isModifying = true;

            this._clearHover();
        });

        this._modify.on('modifyend', () => {
            this._isModifying = false;

            this._layer?.changed();

            this._dispatchChanged();
        });

        // Live values in the panel while a node is dragged.
        this._modify.on('change', () => this._dispatchChangedSoon());

        this._map.addInteraction(this._modify);
    }

    /**
     * Makes a measure the active one (nodes shown, editable), or none.
     * @param {object|null} feature - Measure
     */
    _setActive(feature) {
        this._activeFeature = feature;

        if (this._modifySource) {
            this._modifySource.clear();

            if (feature) {
                this._modifySource.addFeature(feature);
            }
        }

        this._layer?.changed();

        this._dispatchChanged();
    }

    // =====================================================
    // POINTER
    // =====================================================

    _pixelDistance(coord, pixel) {
        const p = this._map.getPixelFromCoordinate(coord);

        return Math.hypot(p[0] - pixel[0], p[1] - pixel[1]);
    }

    /**
     * Closest point of the outline of a measure.
     * @param {object} feature - Measure
     * @param {number[]} coord - Map coordinate
     * @returns {number[]} Closest point
     */
    _closestPoint(feature, coord) {
        const geometry = feature.getGeometry();

        if (geometry.getType() === 'Polygon') {
            return new LineString(geometry.getCoordinates()[0] || []).getClosestPoint(coord);
        }

        return geometry.getClosestPoint(coord);
    }

    /**
     * Measure whose outline is under the pixel (the closest one), or null.
     * The inside of an area doesn't count: a new area can be drawn in it.
     * @param {number[]} pixel - Pixel
     * @returns {object|null} Measure
     */
    _featureAtPixel(pixel) {
        if (!this._source) {
            return null;
        }

        const coord = this._map.getCoordinateFromPixel(pixel);
        let best = null;
        let bestDistance = HIT_TOLERANCE;

        this._source.getFeatures().forEach((feature) => {
            const distance = this._pixelDistance(this._closestPoint(feature, coord), pixel);

            if (distance <= bestDistance) {
                best = feature;
                bestDistance = distance;
            }
        });

        return best;
    }

    /**
     * Vertex of the active measure under the pixel, or null.
     * @param {number[]} pixel - Pixel
     * @returns {number[]|null} Vertex
     */
    _vertexAtPixel(pixel) {
        if (!this._activeFeature) {
            return null;
        }

        let best = null;
        let bestDistance = HIT_TOLERANCE;

        this._vertices(this._activeFeature.getGeometry()).forEach((vertex) => {
            const distance = this._pixelDistance(vertex, pixel);

            if (distance < bestDistance) {
                best = vertex;
                bestDistance = distance;
            }
        });

        return best;
    }

    _clearHover() {
        const changed = this._hoveredFeature || this._hoveredVertex;

        this._hoveredFeature = null;
        this._hoveredVertex = null;
        this._insertCoord = null;

        if (changed) {
            this._layer?.changed();
            this._map.render();
        }

        this._setCursor('');
    }

    _handlePointerMove(evt) {
        if (evt.dragging) {
            return;
        }

        if (this._isDrawing || this._isModifying) {
            this._clearHover();

            return;
        }

        const hovered = this._featureAtPixel(evt.pixel);
        const vertex = hovered && hovered === this._activeFeature ? this._vertexAtPixel(evt.pixel) : null;
        const previousVertex = this._hoveredVertex;

        if (hovered !== this._hoveredFeature) {
            this._hoveredFeature = hovered;

            this._layer.changed();
        }

        this._hoveredVertex = vertex;

        // The size of the hovered node is Modify's style.
        if ((vertex || []).join() !== (previousVertex || []).join()) {
            this._map.render();
        }

        this._insertCoord = hovered && hovered === this._activeFeature && !vertex && TOOLS[this._tool].insertable
            ? this._closestPoint(hovered, evt.coordinate)
            : null;

        if (this._insertCoord) {
            this._setCursor('copy');
        } else if (hovered && hovered !== this._activeFeature) {
            this._setCursor('pointer');
        } else {
            this._setCursor('');
        }
    }

    // Click: inserts a node on the active measure, or makes a measure
    // active. Starting a new measure is handled by Draw.
    _handleClick(evt) {
        if (this._isDrawing || this._isModifying) {
            return;
        }

        if (this._insertCoord) {
            this._insertVertex(this._insertCoord);

            return;
        }

        const feature = this._featureAtPixel(evt.pixel);

        if (feature && feature !== this._activeFeature) {
            this._setActive(feature);

            this._handlePointerMove(evt);
        }
    }

    // =====================================================
    // KEYBOARD AND EDITING
    // =====================================================

    /**
     * Escape: cancels the measure being drawn. Backspace or Delete: while
     * drawing, removes the last point; else deletes the hovered node, or
     * the hovered measure. Ignored while typing in a form field.
     * @param {Event} evt - Keyboard event
     */
    _handleKeyDown(evt) {
        if (isTypingTarget(evt.target) || isTypingTarget(document.activeElement)) {
            return;
        }

        if (evt.key === 'Escape') {
            if (this._isDrawing) {
                evt.preventDefault();

                this._draw.abortDrawing();
            }

            return;
        }

        if (evt.key !== 'Backspace' && evt.key !== 'Delete') {
            return;
        }

        if (this._isDrawing) {
            evt.preventDefault();

            this._draw.removeLastPoint();

            return;
        }

        if (this._hoveredVertex && this._removeVertex(this._hoveredVertex)) {
            evt.preventDefault();

            return;
        }

        if (this._hoveredFeature) {
            evt.preventDefault();

            this._deleteFeature(this._hoveredFeature);
        }
    }

    /**
     * Deletes a node of the active measure, if the measure keeps enough of
     * them.
     * @param {number[]} vertex - Node
     * @returns {boolean} True if the node was deleted
     */
    _removeVertex(vertex) {
        const feature = this._activeFeature;

        if (!feature) {
            return false;
        }

        const vertices = this._vertices(feature.getGeometry());

        if (vertices.length <= TOOLS[this._tool].removableVertices) {
            return false;
        }

        const index = vertices.findIndex((c) => c[0] === vertex[0] && c[1] === vertex[1]);

        if (index === -1) {
            return false;
        }

        vertices.splice(index, 1);

        this._setVertices(feature, vertices);

        this._clearHover();
        this._layer.changed();

        this._dispatchChanged();

        return true;
    }

    _deleteFeature(feature) {
        if (feature === this._activeFeature) {
            this._setActive(null);
        }

        this._clearHover();

        if (this._source.hasFeature(feature)) {
            this._source.removeFeature(feature);
        }

        this._dispatchChanged();
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

    _insertVertex(coord) {
        const feature = this._activeFeature;

        if (!feature) {
            return;
        }

        const segments = this._segments(feature.getGeometry());
        let bestIndex = 0;
        let bestDistance = Infinity;

        segments.forEach(([a, b], index) => {
            const distance = this._distanceToSegment(coord, a, b);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });

        const vertices = this._vertices(feature.getGeometry());

        vertices.splice(bestIndex + 1, 0, coord);

        this._setVertices(feature, vertices);

        this._clearHover();
        this._layer.changed();

        this._dispatchChanged();
    }

    // =====================================================
    // EVENTS, CURSOR, POPUP
    // =====================================================

    _dispatchChanged() {
        /**
         * Measures changed (drawn, modified, deleted, active one changed,
         * settings changed, tool opened or closed).
         * @event Measure#measures.measure.changed
         * @property {string} type measures.measure.changed
         */
        mainEventDispatcher.dispatch('measures.measure.changed');
    }

    // At most once per frame (while drawing or dragging a node).
    _dispatchChangedSoon() {
        if (this._changeFrame) {
            return;
        }

        this._changeFrame = requestAnimationFrame(() => {
            this._changeFrame = null;

            this._dispatchChanged();
        });
    }

    _setCursor(cursor) {
        const target = this._map.getTargetElement();

        if (target) {
            target.style.cursor = cursor;
        }
    }

    // The identify popup opens on any click on the map while its `active`
    // flag is true: it is disabled while a tool is active, and restored to
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
