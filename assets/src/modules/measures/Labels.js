/**
 * @module modules/measures/Labels.js
 * @name Labels
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import Point from 'ol/geom/Point.js';
import { Fill, RegularShape, Style, Text } from 'ol/style.js';

// Labels drawn on the map by the measure tools and the elevation profile,
// as in the OpenLayers "Measure using vector styles" example: the measure
// in a dark box with a tip, the segments in a lighter one, the help next
// to the pointer. Also the formatting of the values.

const LABEL_FONT = '14px Calibri,sans-serif';
const SMALL_FONT = '12px Calibri,sans-serif';
const WHITE = new Fill({ color: 'rgba(255, 255, 255, 1)' });
const DARK = new Fill({ color: 'rgba(0, 0, 0, 0.7)' });
const LIGHT_DARK = new Fill({ color: 'rgba(0, 0, 0, 0.4)' });

const labelTip = new RegularShape({
    radius: 8,
    points: 3,
    angle: Math.PI,
    displacement: [0, 10],
    fill: DARK,
});

const segmentTip = new RegularShape({
    radius: 6,
    points: 3,
    angle: Math.PI,
    displacement: [0, 8],
    fill: LIGHT_DARK,
});

/**
 * Main label of a measure (dark box pointing at the coordinate).
 * @param {string} text - Text (may hold several lines)
 * @param {number[]} coord - Map coordinate
 * @returns {Style} Style
 */
export function mainLabelStyle(text, coord) {
    return new Style({
        geometry: new Point(coord),
        image: labelTip,
        text: new Text({
            text,
            font: LABEL_FONT,
            fill: WHITE,
            backgroundFill: DARK,
            padding: [3, 3, 3, 3],
            textBaseline: 'bottom',
            offsetY: -15,
        }),
    });
}

/**
 * Label of a segment (lighter box pointing at the coordinate).
 * @param {string} text - Text
 * @param {number[]} coord - Map coordinate (middle of the segment)
 * @returns {Style} Style
 */
export function segmentLabelStyle(text, coord) {
    return new Style({
        geometry: new Point(coord),
        image: segmentTip,
        text: new Text({
            text,
            font: SMALL_FONT,
            fill: WHITE,
            backgroundFill: LIGHT_DARK,
            padding: [2, 2, 2, 2],
            textBaseline: 'bottom',
            offsetY: -12,
        }),
    });
}

/**
 * Help next to the pointer (style of the point that follows the pointer).
 * @param {string} text - Text
 * @returns {Style} Style
 */
export function tipStyle(text) {
    return new Style({
        text: new Text({
            text,
            font: SMALL_FONT,
            fill: WHITE,
            backgroundFill: LIGHT_DARK,
            padding: [2, 2, 2, 2],
            textAlign: 'left',
            offsetX: 15,
        }),
    });
}

/**
 * Labels of the length of a line: the length of each segment (if asked,
 * and if there are several) and the total length at the last vertex.
 * @param {number[][]} vertices - Vertices of the line
 * @param {number[]} lengths - Length (m) of each segment
 * @param {boolean} showSegments - Show the length of the segments
 * @returns {Style[]} Styles
 */
export function lineLengthStyles(vertices, lengths, showSegments) {
    const styles = [];

    if (vertices.length < 2) {
        return styles;
    }

    if (showSegments && lengths.length > 1) {
        lengths.forEach((length, index) => {
            const a = vertices[index];
            const b = vertices[index + 1];

            if (length > 0) {
                styles.push(segmentLabelStyle(formatLength(length), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
            }
        });
    }

    styles.push(mainLabelStyle(formatLength(lengths.reduce((sum, length) => sum + length, 0)), vertices[vertices.length - 1]));

    return styles;
}

/**
 * Formats a number in the language of the page.
 * @param {number} value - Number
 * @param {number} decimals - Decimals
 * @returns {string} Formatted number
 */
export function formatNumber(value, decimals) {
    const lang = (document.documentElement.lang || '').replace('_', '-');
    const options = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };

    try {
        return new Intl.NumberFormat(lang || undefined, options).format(value);
    } catch {
        return new Intl.NumberFormat(undefined, options).format(value);
    }
}

/**
 * Formats a length: m under 1 km, else km.
 * @param {number} meters - Length (m)
 * @returns {string} Formatted length
 */
export function formatLength(meters) {
    return meters < 1000 ? `${formatNumber(meters, 2)} m` : `${formatNumber(meters / 1000, 3)} km`;
}

/**
 * Formats an area: m² under 1 ha, ha under 1 km², else km².
 * @param {number} squareMeters - Area (m²)
 * @returns {string} Formatted area
 */
export function formatArea(squareMeters) {
    if (squareMeters < 10000) {
        return `${formatNumber(squareMeters, 2)} m²`;
    }

    if (squareMeters < 1000000) {
        return `${formatNumber(squareMeters / 10000, 4)} ha`;
    }

    return `${formatNumber(squareMeters / 1000000, 4)} km²`;
}

/**
 * Formats an angle in degrees or in grades (gon).
 * @param {number} degrees - Angle (degrees)
 * @param {string} unit - 'deg' or 'gon'
 * @returns {string} Formatted angle
 */
export function formatAngle(degrees, unit) {
    return unit === 'gon' ? `${formatNumber((degrees * 400) / 360, 4)} gon` : `${formatNumber(degrees, 2)}°`;
}
