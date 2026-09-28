/**
 * @module modules/measures/Keyboard.js
 * @name Keyboard
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

// Types of <input> in which the keys are used to type text.
const TEXT_INPUT_TYPES = new Set([
    'text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', 'datetime-local', 'month', 'time', 'week',
]);

/**
 * The element receives typed text: the keyboard shortcuts of the measure
 * tools (Escape, Backspace, Delete) are then left to it.
 * @param {Element|null} element - Focused element (event target)
 * @returns {boolean} True for a text field, a list or an editable area
 */
export function isTypingTarget(element) {
    if (!element || !element.tagName) {
        return false;
    }

    const tag = element.tagName;

    if (tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable) {
        return true;
    }

    return tag === 'INPUT' && TEXT_INPUT_TYPES.has((element.type || 'text').toLowerCase());
}

/**
 * Keys handled by the measure tools.
 * @type {Set<string>}
 */
export const MEASURE_KEYS = new Set(['Escape', 'Backspace', 'Delete']);
