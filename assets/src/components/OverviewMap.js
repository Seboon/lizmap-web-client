/**
 * @module components/OverviewMap.js
 * @name OverviewMap
 * @copyright 2023 3Liz
 * @author BOISTEAULT Nicolas
 * @license MPL-2.0
 */

import { mainLizmap } from '../modules/Globals.js';
import olOverviewMap from 'ol/control/OverviewMap.js';

import ImageWMS from 'ol/source/ImageWMS.js';
import { Image as ImageLayer } from 'ol/layer.js';
import View from 'ol/View.js';
import { getHeight, getWidth } from 'ol/extent.js';

/** Number of zoom-out steps (x2 each) the fixed-scale overview may take. */
const OVERVIEW_ZOOM_OUT_STEPS = 16;

/** Largest part of the overview the box of the map extent may take. */
const OVERVIEW_FIT = 0.9;

/**
 * Overview control of OpenLayers, for a fixed-scale overview (fork).
 *
 * The control recenters the overview only from time to time (when the box
 * of the map extent gets smaller than 1/10 or larger than 3/4 of it), and
 * with the single scale Lizmap gives it, the box could get lost. Here:
 * - the overview always follows the map: it is centered on the map at
 *   every move, the box staying in its middle (like QWC2);
 * - it keeps its scale (the first resolution of its view), the box getting
 *   smaller as the map zooms in (8 px at least, map.css);
 * - when the map shows more than the overview can hold, the overview zooms
 *   out (x2 steps, resolutions of its view) so that the box stays visible,
 *   and comes back to its scale when the map zooms in again.
 */
class FixedScaleOverviewMap extends olOverviewMap {
    validateExtent_() {
        const map = this.getMap();
        const ovmap = this.getOverviewMap();
        if (!map?.isRendered() || !ovmap.isRendered()) {
            return;
        }
        const view = map.getView();
        const extent = view.calculateExtent(map.getSize());
        const ovView = ovmap.getView();
        const ovSize = ovmap.getSize();
        const resolutions = ovView.getResolutions();

        // Smallest resolution of the overview (its own scale first) where
        // the box fits.
        const needed = Math.max(getWidth(extent) / ovSize[0], getHeight(extent) / ovSize[1]) / OVERVIEW_FIT;
        const fitting = resolutions.filter((resolution) => resolution >= needed);
        const resolution = fitting.length ? fitting[fitting.length - 1] : resolutions[0];

        if (ovView.getResolution() !== resolution) {
            ovView.setResolution(resolution);
        }
        const center = view.getCenter();
        const ovCenter = ovView.getCenter();
        if (!ovCenter || ovCenter[0] !== center[0] || ovCenter[1] !== center[1]) {
            ovView.setCenter(center);
        }
    }
}

/**
 * @class
 * @name OverviewMap
 * @augments HTMLElement
 */
export default class OverviewMap extends HTMLElement {
    constructor() {
        super();
    }

    connectedCallback() {

        let overviewInCfg = mainLizmap.state.layersAndGroupsCollection.groups
            .find(group => group.name.toLowerCase() === 'overview' && group.level === 1);

        if (!overviewInCfg) {
            return;
        }

        const overviewLayer = new ImageLayer({
            source: new ImageWMS({
                url: mainLizmap.serviceURL,
                params: {
                    LAYERS: overviewInCfg.wmsName
                },
                ratio: 1.1,
                serverType: 'qgis',
            }),
        });

        // TODO : 'view/embed' can be not present in URL because of URL rewriting
        // => needs better way to detect we're in embed context
        this._isCollapsedAtInit = lizMap.checkMobile() || document.URL.includes('view/embed');

        const hasDynamicView = mainLizmap.config.options?.fixed_scale_overview_map === false;

        const OverviewMapControl = hasDynamicView ? olOverviewMap : FixedScaleOverviewMap;
        const fixedResolution = mainLizmap.map.getView().getResolutionForExtent(mainLizmap.config.options.initialExtent, [220, 100]);
        this._olOverviewMap = new OverviewMapControl({
            layers: [overviewLayer],
            collapsed: this._isCollapsedAtInit,
            target: this,
            tipLabel: lizDict['overviewbar.displayoverview.hover'],
            collapseLabel: '\u00BB',
            label: '\u00AB',
            view: hasDynamicView ? undefined : new View({
                // Fork: the scale fitting the initial extent, then zoomed-out
                // steps used when the map shows more than the overview.
                resolutions: Array.from({ length: OVERVIEW_ZOOM_OUT_STEPS + 1 },
                    (_, step) => fixedResolution * 2 ** (OVERVIEW_ZOOM_OUT_STEPS - step)),
                resolution: fixedResolution,
                projection: mainLizmap.projection === 'EPSG:900913' ? 'EPSG:3857' : mainLizmap.projection
            })
        });

        mainLizmap.map.addControl(
            this._olOverviewMap
        );
    }

    disconnectedCallback() {
        mainLizmap.map.removeControl(
            this._olOverviewMap
        );
    }
}
