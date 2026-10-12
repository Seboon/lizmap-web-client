/**
 * @module modules/CoordinateText.js
 * @name CoordinateText
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { forward as mgrsForward, toPoint as mgrsToPoint } from '../dependencies/mgrs.js';

/**
 * Coordinates and scales as text, for the status bar of the map: written
 * the way they are shown, read back from what the user types.
 *
 * Formats of coordinates:
 * - 'projected': x, y in the units of the CRS (2 decimals);
 * - 'degrees': longitude, latitude in decimal degrees (6 decimals);
 * - 'dm': degrees and decimal minutes, with the hemisphere letter;
 * - 'dms': degrees, minutes and decimal seconds, with the hemisphere letter;
 * - 'mgrs': MGRS reference (from longitude, latitude in WGS 84).
 *
 * Numbers are written with a point as decimal separator and ", " between
 * the two coordinates: the text can be copied as is into QGIS. When
 * reading, a decimal comma is accepted too when the two values are
 * separated by a space or a semicolon.
 */

/** Decimals of each format (minutes for 'dm', seconds for 'dms'). */
const DECIMALS = { projected: 2, degrees: 6, dm: 4, dms: 2 };

/**
 * Writes an angle in degrees and minutes, or degrees, minutes and seconds.
 * @param {number} value - Angle in decimal degrees.
 * @param {'lon'|'lat'} axis - Longitude (E/W) or latitude (N/S).
 * @param {'dm'|'dms'} format - Format.
 * @returns {string} The angle, e.g. 31°14'09.52"E.
 */
function formatAngle(value, axis, format) {
    const hemisphere = axis === 'lat' ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
    const abs = Math.abs(value);
    let degrees = Math.floor(abs);
    let minutes = (abs - degrees) * 60;

    if (format === 'dm') {
        let min = Number(minutes.toFixed(DECIMALS.dm));
        if (min >= 60) {
            min -= 60;
            degrees += 1;
        }
        return `${degrees}°${min.toFixed(DECIMALS.dm).padStart(DECIMALS.dm + 3, '0')}'${hemisphere}`;
    }

    let wholeMinutes = Math.floor(minutes);
    let seconds = Number(((minutes - wholeMinutes) * 60).toFixed(DECIMALS.dms));
    if (seconds >= 60) {
        seconds -= 60;
        wholeMinutes += 1;
    }
    if (wholeMinutes >= 60) {
        wholeMinutes -= 60;
        degrees += 1;
    }
    return `${degrees}°${String(wholeMinutes).padStart(2, '0')}'`
        + `${seconds.toFixed(DECIMALS.dms).padStart(DECIMALS.dms + 3, '0')}"${hemisphere}`;
}

/**
 * Writes coordinates in a format.
 * @param {number[]} coordinates - [x, y], or [longitude, latitude] in
 *   degrees for 'degrees', 'dm', 'dms' and 'mgrs'.
 * @param {string} format - 'projected', 'degrees', 'dm', 'dms' or 'mgrs'.
 * @returns {string} The text, '' when the coordinates can't be written.
 */
export function formatCoordinates(coordinates, format) {
    const [x, y] = coordinates || [];

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return '';
    }

    switch (format) {
        case 'degrees':
            return `${x.toFixed(DECIMALS.degrees)}, ${y.toFixed(DECIMALS.degrees)}`;
        case 'dm':
        case 'dms':
            return `${formatAngle(x, 'lon', format)}, ${formatAngle(y, 'lat', format)}`;
        case 'mgrs':
            try {
                const ref = mgrsForward([x, y]);
                // 36RUU1234567890 -> 36R UU 12345 67890
                return `${ref.slice(0, -12)} ${ref.slice(-12, -10)} ${ref.slice(-10, -5)} ${ref.slice(-5)}`;
            } catch {
                return '';
            }
        default:
            return `${x.toFixed(DECIMALS.projected)}, ${y.toFixed(DECIMALS.projected)}`;
    }
}

/**
 * Reads a number written with a point or a comma as decimal separator.
 * @param {string} text - The number.
 * @returns {number} The number, NaN when it is not one.
 */
function readNumber(text) {
    const clean = String(text).trim().replace(',', '.');
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(clean) ? Number(clean) : NaN;
}

/**
 * Splits a text in two values: the first way of splitting that gives
 * exactly two non-empty parts wins (semicolon, comma followed by a space,
 * spaces, comma).
 * @param {string} text - The text.
 * @returns {string[]|null} The two parts, or null.
 */
function splitInTwo(text) {
    for (const separator of [/\s*;\s*/, /\s*,\s+/, /\s+/, /\s*,\s*/]) {
        const parts = text.split(separator).filter((part) => part !== '');
        if (parts.length === 2) {
            return parts;
        }
    }
    return null;
}

/**
 * Reads an angle: decimal degrees, or degrees, minutes and seconds
 * (30°02'15.5"N, 30 02 15.5 N, -30.0376...). The hemisphere letter or a
 * minus sign gives the sign.
 * @param {string} text - The angle.
 * @returns {{value: number, axis: 'lon'|'lat'|null}|null} The angle in
 *   decimal degrees and its axis when a letter gives it, or null.
 */
function readAngle(text) {
    const letter = (text.match(/[NSEWO]/i) || [''])[0].toUpperCase();
    const numbers = (text.match(/\d+(?:[.,]\d+)?/g) || []).map(readNumber);

    if (numbers.length === 0 || numbers.length > 3 || numbers.some(Number.isNaN)) {
        return null;
    }
    const [degrees, minutes = 0, seconds = 0] = numbers;
    if (minutes >= 60 || seconds >= 60) {
        return null;
    }
    let value = degrees + minutes / 60 + seconds / 3600;
    // "O" (ouest) is accepted for west.
    if (/^\s*-/.test(text) || ['S', 'W', 'O'].includes(letter)) {
        value = -value;
    }
    let axis = null;
    if (letter === 'N' || letter === 'S') {
        axis = 'lat';
    } else if (letter) {
        axis = 'lon';
    }
    return { value, axis };
}

/**
 * Reads coordinates typed by the user.
 * @param {string} text - The text.
 * @param {string} format - Format of the CRS: 'projected', or 'degrees',
 *   'dm', 'dms', 'mgrs' (WGS 84; any of these three angle formats is
 *   accepted in each of them).
 * @returns {number[]|null} [x, y], or [longitude, latitude] for WGS 84;
 *   null when the text can't be read.
 */
export function parseCoordinates(text, format) {
    const value = String(text || '').trim();

    if (value === '') {
        return null;
    }

    if (format === 'mgrs') {
        try {
            const point = mgrsToPoint(value.replace(/\s+/g, '').toUpperCase());
            return point.every(Number.isFinite) ? point : null;
        } catch {
            return null;
        }
    }

    if (format === 'projected') {
        const parts = splitInTwo(value);
        if (!parts) {
            return null;
        }
        const numbers = parts.map(readNumber);
        return numbers.some(Number.isNaN) ? null : numbers;
    }

    // Angles: split at the hemisphere letters when there are two,
    // otherwise like two numbers.
    const withLetters = value.match(/[^NSEWO]*[NSEWO]/gi);
    let parts = withLetters && withLetters.length === 2
        && value.replace(withLetters.join(''), '').replace(/[\s,;]/g, '') === ''
        ? withLetters.map((part) => part.replace(/^[\s,;]+/, ''))
        : splitInTwo(value);
    if (!parts) {
        return null;
    }
    const angles = parts.map(readAngle);
    if (angles.some((angle) => angle === null)) {
        return null;
    }
    // Longitude first, unless the letters say otherwise.
    let [lon, lat] = angles;
    if (lon.axis === 'lat' || lat.axis === 'lon') {
        [lon, lat] = [lat, lon];
    }
    if (Math.abs(lat.value) > 90 || Math.abs(lon.value) > 180) {
        return null;
    }
    return [lon.value, lat.value];
}

/**
 * Reads a scale typed by the user: 25000, 25 000, 1:25000, 1/25 000,
 * 1 : 25 000.
 * @param {string} text - The text.
 * @returns {number|null} The scale denominator, or null.
 */
export function parseScale(text) {
    const clean = String(text || '').replace(/[\s\u00a0\u202f]/g, '').replace(/^1[:/]/, '');
    if (!/^\d+([.,]\d+)?$/.test(clean)) {
        return null;
    }
    const scale = Number(clean.replace(',', '.'));
    return scale > 0 ? scale : null;
}

/**
 * Index of the scale of a list closest to a scale, compared as ratios.
 * @param {number[]} scales - Scale denominators.
 * @param {number} scale - The scale denominator wanted.
 * @returns {number} The index, -1 for an empty list.
 */
export function nearestScaleIndex(scales, scale) {
    let best = -1;
    let bestDistance = Infinity;
    scales.forEach((candidate, index) => {
        const distance = Math.abs(Math.log(candidate / scale));
        if (distance < bestDistance) {
            best = index;
            bestDistance = distance;
        }
    });
    return best;
}
