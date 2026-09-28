/**
 * @module components/measures/MeasurePanel.js
 * @name MeasurePanel
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../../modules/Globals.js';
import Measure from '../../modules/measures/Measure.js';
import { html, render } from 'lit-html';

/**
 * Panel of the measure tools (length, area, angle, bearing), shown in the
 * window of the tool: its settings (length of the segments on the map,
 * help next to the pointer, computation on the ellipsoid or in the map
 * projection, unit of the angles), the detail of the measure being drawn or of the active one
 * (like the measure dialog of QGIS Desktop), and a button to remove all
 * the measures. The measures themselves are drawn by the Measure module
 * (mainLizmap.measure).
 * @class
 * @name MeasurePanel
 * @augments HTMLElement
 */
export default class MeasurePanel extends HTMLElement {
    constructor() {
        super();

        this._onChanged = () => this._render();
    }

    connectedCallback() {
        this.classList.add('lizmap-measure-panel');

        mainEventDispatcher.addListener(this._onChanged, 'measures.measure.changed');

        this._render();
    }

    disconnectedCallback() {
        mainEventDispatcher.removeListener(this._onChanged, 'measures.measure.changed');
    }

    /**
     * The measure module.
     * @type {object}
     */
    get _module() {
        return mainLizmap.measure;
    }

    _setSetting(name, value) {
        this._module.setSetting(name, value);
    }

    /**
     * Settings of the active tool.
     * @param {string} tool - Active tool
     * @returns {object} lit-html template
     */
    _settingsTemplate(tool) {
        const settings = this._module.settings;
        const lengths = tool === 'length' || tool === 'area';
        const angles = tool === 'angle' || tool === 'bearing';

        return html`
            <div class="measure-panel-settings">
                ${tool !== 'bearing' ? html`
                    <label class="measure-panel-check">
                        <input type="checkbox" class="measure-panel-segments"
                            .checked=${settings.segments}
                            @change=${(event) => this._setSetting('segments', event.target.checked)}>
                        <span>${lizDict['measures.measure.segments']}</span>
                    </label>` : ''}
                <label class="measure-panel-check">
                    <input type="checkbox" class="measure-panel-tips"
                        .checked=${settings.tips}
                        @change=${(event) => this._setSetting('tips', event.target.checked)}>
                    <span>${lizDict['measures.measure.tips']}</span>
                </label>
                ${lengths && this._module.cartesianAvailable ? html`
                    <label class="measure-panel-field">
                        <span>${lizDict['measures.measure.calc']}</span>
                        <select class="measure-panel-calc"
                            @change=${(event) => this._setSetting('calc', event.target.value)}>
                            <option value="ellipsoidal" ?selected=${settings.calc !== 'cartesian'}>
                                ${lizDict['measures.measure.calc.ellipsoidal']}
                            </option>
                            <option value="cartesian" ?selected=${settings.calc === 'cartesian'}>
                                ${lizDict['measures.measure.calc.cartesian'].replace('{crs}', this._module.projectionCode)}
                            </option>
                        </select>
                    </label>` : ''}
                ${angles ? html`
                    <label class="measure-panel-field">
                        <span>${lizDict['measures.measure.angleUnit']}</span>
                        <select class="measure-panel-unit"
                            @change=${(event) => this._setSetting('angleUnit', event.target.value)}>
                            <option value="deg" ?selected=${settings.angleUnit !== 'gon'}>${lizDict['measures.measure.unit.deg']}</option>
                            <option value="gon" ?selected=${settings.angleUnit === 'gon'}>${lizDict['measures.measure.unit.gon']}</option>
                        </select>
                    </label>` : ''}
            </div>`;
    }

    /**
     * A row "name: value" of the results.
     * @param {string} name - Name
     * @param {string} value - Value
     * @param {string} [className] - Class of the value
     * @returns {object} lit-html template
     */
    _row(name, value, className = '') {
        return html`<tr><th>${name}</th><td class=${className}>${value}</td></tr>`;
    }

    /**
     * Detail of a measure.
     * @param {object} result - Measure (see Measure#measure)
     * @returns {object} lit-html template
     */
    _resultTemplate(result) {
        const unit = this._module.settings.angleUnit;

        switch (result.tool) {
            case 'length':
                return html`
                    <table class="measure-panel-table measure-panel-segments-table">
                        <thead><tr>
                            <th>${lizDict['measures.measure.segment']}</th>
                            <th>${lizDict['measures.measure.length']}</th>
                        </tr></thead>
                        <tbody>
                            ${result.segments.map((length, index) => html`
                                <tr><td>${index + 1}</td><td>${Measure.formatLength(length)}</td></tr>`)}
                        </tbody>
                        <tfoot><tr>
                            <th>${lizDict['measures.measure.total']}</th>
                            <td class="measure-panel-total">${Measure.formatLength(result.total)}</td>
                        </tr></tfoot>
                    </table>`;
            case 'area':
                return html`
                    <table class="measure-panel-table">
                        ${this._row(lizDict['measures.measure.area'], Measure.formatArea(result.area), 'measure-panel-area')}
                        ${this._row(lizDict['measures.measure.perimeter'], Measure.formatLength(result.perimeter), 'measure-panel-perimeter')}
                    </table>`;
            case 'angle':
                return html`
                    <table class="measure-panel-table">
                        ${this._row(
                            lizDict['measures.measure.angle'],
                            result.angle === null ? '–' : Measure.formatAngle(result.angle, unit),
                            'measure-panel-angle',
                        )}
                        ${result.segments.map((length, index) => this._row(
                            `${lizDict['measures.measure.segment']} ${index + 1}`,
                            Measure.formatLength(length),
                        ))}
                    </table>`;
            case 'bearing':
                return html`
                    <table class="measure-panel-table">
                        ${this._row(lizDict['measures.measure.azimuth'], Measure.formatAngle(result.azimuth, unit), 'measure-panel-azimuth')}
                        ${result.gridBearing !== null ? this._row(
                            lizDict['measures.measure.gridBearing'],
                            Measure.formatAngle(result.gridBearing, unit),
                            'measure-panel-grid-bearing',
                        ) : ''}
                        ${this._row(lizDict['measures.measure.distance'], Measure.formatLength(result.distance), 'measure-panel-distance')}
                    </table>`;
            default:
                return '';
        }
    }

    _render() {
        const module = this._module;
        const tool = module?.tool;

        if (!tool) {
            render(html``, this);

            return;
        }

        const result = module.currentResult();

        render(html`
            ${this._settingsTemplate(tool)}
            <div class="measure-panel-result">
                ${result ? this._resultTemplate(result) : html`
                    <p class="measure-panel-hint">${lizDict['measures.measure.hint.draw']}</p>`}
            </div>
            <div class="measure-panel-footer">
                <p class="measure-panel-keys">${lizDict['measures.measure.hint.keys']}</p>
                <button type="button" class="btn btn-mini measure-panel-clear"
                    ?disabled=${module.count === 0 && !module.drawing}
                    @click=${() => module.clear()}>${lizDict['measures.measure.clear']}</button>
            </div>
        `, this);
    }
}
