/**
 * @module modules/WindowsArea.js
 * @name WindowsArea
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

/** Id of the area the dockable windows are placed in. */
export const WINDOWS_AREA_ID = 'map-windows-area';

/**
 * Area of the map where the dockable windows (<lizmap-dock-window>: measure
 * tools, elevation profile, Lizmap panels) are placed: the whole map
 * (#map-content) except the status bar at its bottom. A window docked to
 * the bottom edge sits on the status bar, a docked or maximized window
 * never covers it, and a floating one stays above it.
 *
 * The area is created in #map-content the first time it is asked for. It
 * lets the clicks through to the map (pointer-events: none in map.css);
 * the windows inside it take them. It has no z-index: the windows keep
 * theirs among the other elements of the map.
 * @param {Document} [doc] - The document of the map page.
 * @returns {HTMLElement|null} The area, or null when there is no map.
 */
export function windowsArea(doc = document) {
    let area = doc.getElementById(WINDOWS_AREA_ID);

    if (area) {
        return area;
    }

    const mapContent = doc.getElementById('map-content');

    if (!mapContent) {
        return null;
    }

    area = doc.createElement('div');
    area.id = WINDOWS_AREA_ID;
    mapContent.appendChild(area);

    return area;
}
