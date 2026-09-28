/**
 * @module modules/measures/Settings.js
 * @name Settings
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

import { mainEventDispatcher } from '../Globals.js';

// Display settings shared by the measure tools and the elevation profile,
// remembered in the browser.

/**
 * Key of the settings in the browser storage.
 * @type {string}
 */
const SETTINGS_KEY = 'lizmap-measure-settings';

/**
 * Allowed values of each setting (the first one is the default).
 * - segments: length of the segments on the map;
 * - tips: help next to the pointer;
 * - calc: computation of lengths and areas;
 * - angleUnit: unit of the angles.
 * @type {{[name: string]: Array<boolean|string>}}
 */
const VALUES = {
    segments: [true, false],
    tips: [true, false],
    calc: ['ellipsoidal', 'cartesian'],
    angleUnit: ['deg', 'gon'],
};

const read = () => {
    const settings = Object.fromEntries(Object.entries(VALUES).map(([name, values]) => [name, values[0]]));

    try {
        const stored = JSON.parse(globalThis.localStorage.getItem(SETTINGS_KEY) || '{}');

        Object.keys(VALUES).forEach((name) => {
            if (VALUES[name].includes(stored?.[name])) {
                settings[name] = stored[name];
            }
        });
    } catch {
        // Storage unavailable: default settings.
    }

    return settings;
};

let current = null;

/**
 * Current settings.
 * @returns {{segments: boolean, tips: boolean, calc: string, angleUnit: string}} Settings
 */
export function getSettings() {
    if (!current) {
        current = read();
    }

    return { ...current };
}

/**
 * Changes a setting, remembers it, and tells the tools.
 * @param {string} name - Setting
 * @param {boolean|string} value - Value
 * @fires settings#measures.settings.changed
 */
export function setSetting(name, value) {
    if (!VALUES[name]?.includes(value)) {
        return;
    }

    current = { ...getSettings(), [name]: value };

    try {
        globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    } catch {
        // Storage unavailable: kept until the page is closed.
    }

    /**
     * A display setting of the measure tools changed.
     * @event settings#measures.settings.changed
     * @property {string} type measures.settings.changed
     */
    mainEventDispatcher.dispatch('measures.settings.changed');
}
