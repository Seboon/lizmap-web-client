/**
 * @module components/StatusBar.js
 * @name StatusBar
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { mainLizmap } from '../modules/Globals.js';
import { ADJUSTED_DPI } from '../utils/Constants.js';
import { formatNumber } from '../modules/measures/Labels.js';
import {
    formatCoordinates, parseCoordinates, parseScale,
} from '../modules/CoordinateText.js';
import MGRS from '../modules/MGRS.js';
import { html, render } from 'lit-html';
import ScaleLine from 'ol/control/ScaleLine.js';
import { transform, get as getProjection } from 'ol/proj.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { RegularShape, Stroke, Style } from 'ol/style.js';

/** CRS of the angle formats. */
const WGS84 = 'EPSG:4326';

/**
 * Style of the point marked by typed coordinates: a black cross with a
 * white halo, readable on any background.
 * @param {number} width - Width of the stroke.
 * @param {string} color - Color of the stroke.
 * @returns {Style} The style.
 */
const crossStyle = (width, color) => new Style({
    image: new RegularShape({
        points: 4,
        radius: 10,
        radius2: 0,
        angle: 0,
        stroke: new Stroke({ color, width }),
    }),
});
const POINT_STYLE = [crossStyle(5, 'rgba(255, 255, 255, 0.9)'), crossStyle(2, '#000')];

/**
 * Text of the dictionary of the page, or a fallback.
 * @param {string} key - Key of the dictionary.
 * @param {string} fallback - Text when the key is missing.
 * @returns {string} The text.
 */
const tr = (key, fallback) => globalThis.lizDict?.[key] || fallback;

/**
 * Status bar at the bottom of the map, like the status bar of QGIS Desktop
 * and the bottom bar of QWC2 (<lizmap-status-bar>):
 * - a scale line;
 * - the coordinates under the mouse, in the CRS chosen in the list next to
 *   them (the CRS of the project, of the map and of the layers of the
 *   project, WGS 84 in decimal degrees, degrees and minutes, degrees
 *   minutes seconds, and MGRS). The field is editable: typing coordinates
 *   and Enter centers the map on them and marks the point with a black
 *   cross; the cross and the button next to the field that removes it go
 *   away as soon as the mouse goes back on the map (Escape gives the
 *   field back to the mouse);
 * - the scale: a list of the scales of the project with a field to type
 *   any scale (continuous scale, between the smallest and the largest
 *   scales of the project);
 * - the attributions of the layers (#attribution-box moved here).
 *
 * The bar lies over the bottom of the map. The dockable windows stay above
 * it (modules/WindowsArea.js, --lizmap-status-bar-height in map.css). On
 * small screens (mobile layout) and in embedded maps, only the
 * attributions are shown and the overview keeps its coordinates and scale.
 * @class
 * @name StatusBar
 * @augments HTMLElement
 */
export default class StatusBar extends HTMLElement {
    constructor() {
        super();
        this._crsChoice = 'project';
        this._mouse = null;
        this._editingCoordinates = false;
        this._editingScale = false;
        this._pointShown = false;
        this._invalidCoordinates = false;
        this._invalidScale = false;
    }

    connectedCallback() {
        const map = mainLizmap.map;
        const options = mainLizmap.initialConfig?.options || {};
        this._showScale = !options.hide_numeric_scale_value;
        this._crsList = this._buildCrsList();

        // Layer of the point marked by typed coordinates.
        this._pointSource = new VectorSource({ wrapX: false });
        this._pointLayer = new VectorLayer({ source: this._pointSource, style: POINT_STYLE });
        this._pointLayer.setProperties({ name: 'LizmapStatusBarPoint' });
        map.addToolLayer(this._pointLayer);

        this._render();

        // Scale line.
        this._scaleLine = new ScaleLine({
            target: this.querySelector('.status-bar-scale-line'),
            className: 'status-bar-scale-line-control',
            minWidth: 64,
            units: 'metric',
            dpi: ADJUSTED_DPI,
        });
        map.addControl(this._scaleLine);

        // Attributions of the layers.
        const attribution = document.getElementById('attribution-box');
        if (attribution) {
            this.querySelector('.status-bar-attribution').appendChild(attribution);
        }

        // Mouse position: new map and legacy map, like <lizmap-mouse-position>.
        this._onPointerMove = (evt) => {
            if (evt?.coordinate) {
                this._mouseOnMap(evt.coordinate);
            }
        };
        this._onLegacyMouseMove = (evt) => {
            const lonlat = evt?.xy ? mainLizmap.lizmap3?.map?.getLonLatFromPixel(evt.xy) : null;
            if (lonlat) {
                this._mouseOnMap([lonlat.lon, lonlat.lat]);
            }
        };
        map.on('pointermove', this._onPointerMove);
        mainLizmap.lizmap3?.map?.events?.register('mousemove', this, this._onLegacyMouseMove);

        // Scale.
        this._onMapChanged = (evt) => {
            if (Object.hasOwn(evt, 'zoom') || Object.hasOwn(evt, 'resolution')) {
                this._render();
            }
        };
        mainLizmap.state.map.addListener(this._onMapChanged, ['map.state.changed']);
    }

    disconnectedCallback() {
        mainLizmap.map.removeControl(this._scaleLine);
        mainLizmap.map.un('pointermove', this._onPointerMove);
        mainLizmap.lizmap3?.map?.events?.unregister('mousemove', this, this._onLegacyMouseMove);
        mainLizmap.state.map.removeListener(this._onMapChanged, ['map.state.changed']);
        mainLizmap.map.removeToolLayer(this._pointLayer);
        this._showMgrsGrid(false);
    }

    /**
     * CRS offered for the coordinates.
     * @returns {{value: string, crs: string, format: string, label: string}[]} The list.
     */
    _buildCrsList() {
        const list = [];
        const known = new Set();
        const formatOf = (crs) => (getProjection(crs)?.getUnits() === 'degrees' ? 'degrees' : 'projected');
        const add = (crs, suffix) => {
            if (!crs || known.has(crs) || crs === WGS84 || crs === 'CRS:84' || !getProjection(crs)) {
                return;
            }
            known.add(crs);
            list.push({ value: crs, crs, format: formatOf(crs), label: suffix ? `${crs} (${suffix})` : crs });
        };

        add(mainLizmap.qgisProjectProjection, tr('statusbar.crs.project', 'project'));
        add(mainLizmap.projection, tr('statusbar.crs.map', 'map'));
        for (const crs of Object.keys(globalThis.lizProj4 || {}).sort()) {
            add(crs, '');
        }
        if (list.length) {
            // The CRS of the project is the first one.
            list[0].value = 'project';
        }

        list.push(
            { value: 'degrees', crs: WGS84, format: 'degrees', label: `WGS 84 (${tr('mouseposition.units.d', 'Degrees')})` },
            { value: 'dm', crs: WGS84, format: 'dm', label: `WGS 84 (${tr('mouseposition.units.dm', 'Deg. Min.')})` },
            { value: 'dms', crs: WGS84, format: 'dms', label: `WGS 84 (${tr('mouseposition.units.dms', 'D. M. S.')})` },
            { value: 'mgrs', crs: WGS84, format: 'mgrs', label: 'MGRS' },
        );
        return list;
    }

    /**
     * Entry of the CRS list chosen for the coordinates.
     * @type {{value: string, crs: string, format: string, label: string}}
     */
    get crs() {
        return this._crsList.find((item) => item.value === this._crsChoice) || this._crsList[0];
    }

    /**
     * Chooses the CRS of the coordinates.
     * @param {string} value - Value of an entry of the CRS list.
     */
    set crsChoice(value) {
        if (!this._crsList.some((item) => item.value === value)) {
            return;
        }
        this._crsChoice = value;
        this._showMgrsGrid(this.crs.format === 'mgrs');
        this._render();
        this._updateCoordinates(true);
    }

    /**
     * Shows or hides the MGRS grid on the map (like <lizmap-mouse-position>).
     * @param {boolean} show - Show it.
     */
    _showMgrsGrid(show) {
        if (show && !this._mgrsShown) {
            this._mgrs ||= new MGRS({ showLabels: true, wrapX: false });
            this._mgrs.setProperties({ name: 'LizmapStatusBarMGRS' });
            mainLizmap.map.addToolLayer(this._mgrs);
            this._mgrsShown = true;
        } else if (!show && this._mgrsShown) {
            mainLizmap.map.removeToolLayer(this._mgrs);
            this._mgrsShown = false;
        }
    }

    /**
     * The mouse moves over the map: its coordinates go in the field, and
     * the point marked by typed coordinates goes away with its button.
     * @param {number[]} coordinate - Position of the mouse in the map CRS.
     */
    _mouseOnMap(coordinate) {
        this._mouse = coordinate;
        if (this._pointShown) {
            this._clearPoint();
        }
        this._updateCoordinates();
    }

    /**
     * Coordinates of the mouse as text in the chosen CRS.
     * @returns {string} The text.
     */
    _mouseText() {
        if (!this._mouse) {
            return '';
        }
        try {
            const coordinates = transform(this._mouse, mainLizmap.projection, this.crs.crs);
            return formatCoordinates(coordinates, this.crs.format);
        } catch {
            return '';
        }
    }

    /**
     * Writes the coordinates of the mouse in the field, unless the user is
     * typing in it.
     * @param {boolean} [force] - Also when the user is typing.
     */
    _updateCoordinates(force = false) {
        const input = this.querySelector('.status-bar-coordinates-input');
        if (input && (force || !this._editingCoordinates)) {
            input.value = this._mouseText();
        }
    }

    /**
     * Centers the map on the coordinates typed in the field and marks them.
     * @param {HTMLElement} input - The field.
     */
    _goToCoordinates(input) {
        const coordinates = parseCoordinates(input.value, this.crs.format);
        let inMap = null;
        if (coordinates) {
            try {
                inMap = transform(coordinates, this.crs.crs, mainLizmap.projection);
            } catch {
                inMap = null;
            }
        }
        this._invalidCoordinates = !inMap || !inMap.every(Number.isFinite);
        if (this._invalidCoordinates) {
            this._render();
            return;
        }
        mainLizmap.center = inMap;
        this._pointSource.clear();
        this._pointSource.addFeature(new Feature(new Point(inMap)));
        this._pointShown = true;
        this._mouse = inMap;
        this._editingCoordinates = false;
        input.blur();
        this._render();
        this._updateCoordinates(true);
    }

    /** Removes the point marked by typed coordinates. */
    _clearPoint() {
        this._pointSource.clear();
        this._pointShown = false;
        this._render();
    }

    /**
     * Scale denominators of the zoom levels of the map view (the scales of
     * the project), offered in the list.
     * @type {number[]}
     */
    get scales() {
        return (mainLizmap.map.getView().getResolutions() || []).map((resolution) => this._scaleOf(resolution));
    }

    /**
     * Current scale denominator of the map (continuous scale: it can be
     * between the scales of the list).
     * @type {number}
     */
    get scale() {
        return this._scaleOf(mainLizmap.map.getView().getResolution());
    }

    /**
     * Factor between a resolution of the map and its scale denominator.
     * @returns {number} The factor.
     */
    _scaleFactor() {
        const metersPerUnit = mainLizmap.map.getView().getProjection().getMetersPerUnit() || 1;
        return (1000 / 25.4) * ADJUSTED_DPI * metersPerUnit;
    }

    /**
     * Scale denominator of a resolution.
     * @param {number} resolution - Resolution of the map.
     * @returns {number} The scale denominator.
     */
    _scaleOf(resolution) {
        return resolution * this._scaleFactor();
    }

    /**
     * Zooms the map to a scale, keeping its center. The scale is kept
     * between the smallest and the largest scales of the project.
     * @param {number} scale - Scale denominator.
     */
    setScale(scale) {
        const view = mainLizmap.map.getView();
        const resolution = Math.min(Math.max(scale / this._scaleFactor(), view.getMinResolution()), view.getMaxResolution());
        if (Math.abs(resolution - view.getResolution()) > 1e-9 * resolution) {
            mainLizmap.state.map.update({ 'resolution': resolution });
        }
    }

    /**
     * Zooms the map to the typed scale.
     * @param {HTMLElement} input - The field.
     */
    _goToScale(input) {
        const scale = parseScale(input.value);
        this._invalidScale = scale === null;
        if (!this._invalidScale) {
            this._editingScale = false;
            input.blur();
            this.setScale(scale);
        }
        this._render();
    }

    _render() {
        const crs = this.crs;
        const scales = this.scales;
        const scale = this.scale;
        const scaleText = Number.isFinite(scale) ? formatNumber(Math.round(scale), 0) : '';
        // Scale of the list shown by the map, if it is one of them.
        const listed = scales.findIndex((item) => Math.abs(Math.log(item / scale)) < 0.005);
        const listValue = listed >= 0 ? String(listed) : '';

        render(html`
            <div class="status-bar-scale-line"></div>
            <span class="status-bar-spacer"></span>
            <div class="status-bar-group status-bar-coordinates">
                <label class="status-bar-label">${tr('statusbar.coordinates', 'Coordinates')}</label>
                <input type="text" spellcheck="false" autocomplete="off"
                    class="status-bar-coordinates-input ${this._invalidCoordinates ? 'invalid' : ''}"
                    title="${this._invalidCoordinates
                        ? tr('statusbar.coordinates.invalid', 'Coordinates not understood')
                        : tr('statusbar.coordinates.title', 'Coordinates under the mouse; type coordinates and press Enter to center the map on them')}"
                    aria-label="${tr('statusbar.coordinates', 'Coordinates')}"
                    @focus=${(event) => { this._editingCoordinates = true; event.target.select(); }}
                    @blur=${() => { this._editingCoordinates = false; }}
                    @input=${() => { if (this._invalidCoordinates) { this._invalidCoordinates = false; this._render(); } }}
                    @keydown=${(event) => {
                        if (event.key === 'Enter') {
                            this._goToCoordinates(event.target);
                        } else if (event.key === 'Escape') {
                            this._invalidCoordinates = false;
                            this._editingCoordinates = false;
                            event.target.blur();
                            this._render();
                            this._updateCoordinates(true);
                        }
                    }}>
                ${this._pointShown ? html`
                    <button type="button" class="status-bar-clear-point" title="${tr('mouseposition.removeCenterPoint', 'Remove center point')}"
                        aria-label="${tr('mouseposition.removeCenterPoint', 'Remove center point')}"
                        @click=${() => this._clearPoint()}>×</button>` : ''}
                <select class="status-bar-crs" title="${tr('statusbar.crs.title', 'Coordinate reference system')}"
                    aria-label="${tr('statusbar.crs.title', 'Coordinate reference system')}"
                    @change=${(event) => { this.crsChoice = event.target.value; }}>
                    ${this._crsList.map((item) => html`
                        <option value="${item.value}" ?selected=${item.value === crs.value}>${item.label}</option>`)}
                </select>
            </div>
            ${this._showScale ? html`
            <div class="status-bar-group status-bar-scale">
                <label class="status-bar-label">${tr('statusbar.scale', 'Scale')}</label>
                <div class="status-bar-scale-combo" title="${tr('statusbar.scale.title', 'Scale of the map: choose it in the list, or type it and press Enter')}">
                    <span class="status-bar-scale-prefix">1:</span>
                    <select class="status-bar-scale-select" tabindex="-1" aria-hidden="true"
                        @change=${(event) => this.setScale(scales[parseInt(event.target.value, 10)])}>
                        <option value="" hidden ?selected=${listed < 0}></option>
                        ${scales.map((item, index) => html`
                            <option value="${index}" ?selected=${index === listed}>${formatNumber(Math.round(item), 0)}</option>`)}
                    </select>
                    <input type="text" spellcheck="false" autocomplete="off" inputmode="numeric"
                        class="status-bar-scale-input ${this._invalidScale ? 'invalid' : ''}"
                        aria-label="${tr('statusbar.scale', 'Scale')}"
                        @focus=${(event) => { this._editingScale = true; event.target.select(); }}
                        @blur=${() => { this._editingScale = false; this._invalidScale = false; this._render(); }}
                        @keydown=${(event) => {
                            if (event.key === 'Enter') {
                                this._goToScale(event.target);
                            } else if (event.key === 'Escape') {
                                event.target.blur();
                            }
                        }}>
                </div>
            </div>` : ''}
            <span class="status-bar-spacer"></span>
            <div class="status-bar-attribution"></div>
        `, this);

        // Keep the lists and the scale field in step with the map.
        const crsSelect = this.querySelector('.status-bar-crs');
        if (crsSelect && crsSelect.value !== crs.value) {
            crsSelect.value = crs.value;
        }
        const scaleSelect = this.querySelector('.status-bar-scale-select');
        if (scaleSelect && scaleSelect.value !== listValue) {
            scaleSelect.value = listValue;
        }
        const scaleInput = this.querySelector('.status-bar-scale-input');
        if (scaleInput && !this._editingScale) {
            scaleInput.value = scaleText;
        }
    }
}
