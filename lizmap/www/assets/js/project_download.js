/**
 * Download buttons of the QGIS projects (home page, information of the
 * project on the map): state of the zip of each project, asked to the
 * server (view~projectDownload:status), shown in the tooltip and next to
 * the icon: waiting, progress of the preparation in %, or size and date
 * of the zip when it is ready. Refreshed every few seconds while a zip
 * is waiting or being prepared.
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */
(function () {
    'use strict';

    const REFRESH_MS = 3000;
    const STATES = ['none', 'queued', 'building', 'ready'];

    /**
     * @returns {HTMLAnchorElement[]} the download buttons of the page
     */
    function buttons() {
        return Array.from(document.querySelectorAll('a.liz-project-download[data-download-item]'));
    }

    /**
     * Shows the state of a project on its buttons.
     * @param {HTMLAnchorElement[]} links buttons of the project
     * @param {object} status state, label and title given by the server
     */
    function show(links, status) {
        for (const link of links) {
            for (const state of STATES) {
                link.classList.toggle('liz-project-download-' + state, status.state === state);
            }
            if (status.title) {
                link.title = status.title;
                link.setAttribute('aria-label', status.title);
            }
            const label = link.querySelector('.liz-project-download-state');
            if (label) {
                label.textContent = status.label ? ' ' + status.label : '';
            }
        }
    }

    /**
     * Asks the server the state of the given projects, then again while
     * some of them are waiting or being prepared.
     * @param {string[]} items keys "repository~project"
     */
    async function refresh(items) {
        const links = buttons();
        if (!links.length || !items.length) {
            return;
        }
        const url = new URL(links[0].dataset.downloadStatus, window.location.href);
        url.searchParams.set('items', items.join(','));

        let data;
        try {
            const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (!response.ok) {
                return;
            }
            data = await response.json();
        } catch {
            // Network error: the buttons keep their last state.
            return;
        }

        const pending = [];
        for (const [item, status] of Object.entries(data || {})) {
            show(links.filter((link) => link.dataset.downloadItem === item), status);
            if (status.state === 'queued' || status.state === 'building') {
                pending.push(item);
            }
        }
        if (pending.length) {
            window.setTimeout(() => refresh(pending), REFRESH_MS);
        }
    }

    /**
     * First request, with all the projects of the page.
     */
    function start() {
        const items = [...new Set(buttons().map((link) => link.dataset.downloadItem))];
        refresh(items);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
