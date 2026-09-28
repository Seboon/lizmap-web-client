/**
 * @module modules/measures/Styles.js
 * @name Styles
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style } from 'ol/style.js';

// Look of the lines drawn by the measure tools (elevation profile, length,
// area, angle, bearing): every tool draws the same way.

/**
 * Color of the drawn lines.
 * @type {string}
 */
export const LINE_COLOR = '#666';

/**
 * Width (px) of the drawn lines.
 * @type {number}
 */
export const LINE_WIDTH = 3;

/**
 * A drawn line.
 * @type {Style}
 */
export const lineStyle = new Style({
    stroke: new Stroke({ color: LINE_COLOR, width: LINE_WIDTH }),
});

/**
 * Halo drawn behind a hovered line that isn't the active one: clicking it
 * would make it active.
 * @type {Style}
 */
export const lineHaloStyle = new Style({
    stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.85)', width: 7 }),
});

/**
 * Hovered inactive line: the line with its halo.
 * @type {Style[]}
 */
export const lineHoverStyle = [lineHaloStyle, lineStyle];

/**
 * Inside of a measured area.
 * @type {Fill}
 */
export const areaFill = new Fill({ color: 'rgba(255, 255, 255, 0.25)' });

/**
 * Nodes (vertices) of the active line.
 * @type {Style}
 */
export const nodeStyle = new Style({
    image: new CircleStyle({
        radius: 4.5,
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: LINE_COLOR, width: 1.3 }),
    }),
});

/**
 * Vertex under the pointer of the Modify interaction (can be dragged),
 * also used for the point of the line hovered on a graph.
 * @type {Style}
 */
export const vertexStyle = new Style({
    image: new CircleStyle({
        radius: 4.5,
        fill: new Fill({ color: '#444' }),
        stroke: new Stroke({ color: '#fff', width: 1.3 }),
    }),
});

/**
 * Hovered vertex: bigger (it can be dragged, or deleted with Backspace).
 * @type {Style}
 */
export const hoveredVertexStyle = new Style({
    image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: '#444' }),
        stroke: new Stroke({ color: '#fff', width: 1.8 }),
    }),
});

/**
 * Small white square under the pointer while a line can be drawn.
 * @type {RegularShape}
 */
export const pointerShape = new RegularShape({
    points: 4,
    radius: 5.8,
    angle: Math.PI / 4,
    fill: new Fill({ color: 'white' }),
    stroke: new Stroke({ color: '#333', width: 1 }),
});

/**
 * Line being drawn, with the pointer square.
 * @type {Style}
 */
export const drawStyle = new Style({
    stroke: new Stroke({ color: LINE_COLOR, width: LINE_WIDTH }),
    image: pointerShape,
});

/**
 * Line being drawn, without the pointer square (near an existing line or
 * node, where a new line can't start).
 * @type {Style}
 */
export const drawStyleNoPointer = new Style({
    stroke: new Stroke({ color: LINE_COLOR, width: LINE_WIDTH }),
});
