/**
 * @module components/EditionAccess.js
 * @name EditionAccess
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

/**
 * Prefix of the localStorage key recording that the user has sent a
 * request for a project. Not the key of the first version
 * ('lizmap-edition-access-notice'), which was set as soon as the notice
 * was shown and would hide it for good.
 * @type {string}
 */
const NOTICE_KEY = 'lizmap-edition-access-sent';

/**
 * Content of the "Edition" entry of the map when the project has editable
 * layers that the current user cannot edit (template map_edition_access).
 *
 * - At each opening of the project, a message on the map tells the user
 * that the project has editable layers, with a link opening this entry,
 * until the user sends a request (per project and browser). Closing it
 * only hides it until the next opening.
 * - The form sends the request for access to the administrators
 * (view~editionAccess:request), and shows the answer of the server.
 * @class
 * @name EditionAccess
 * @augments HTMLElement
 */
export default class EditionAccess extends HTMLElement {
    constructor() {
        super();

        this._onSubmit = (event) => {
            event.preventDefault();
            this._send();
        };
    }

    connectedCallback() {
        this._form = this.querySelector('.edition-access-form');
        this._result = this.querySelector('.edition-access-result');
        this._form?.addEventListener('submit', this._onSubmit);

        this._showNotice();
    }

    disconnectedCallback() {
        this._form?.removeEventListener('submit', this._onSubmit);
    }

    /**
     * localStorage key of the project.
     * @type {string}
     */
    get _noticeKey() {
        return `${NOTICE_KEY}:${this.dataset.repository}~${this.dataset.project}`;
    }

    /**
     * Records that the notice must not be shown any more for the project.
     */
    _dismissNotice() {
        try {
            localStorage.setItem(this._noticeKey, '1');
        } catch {
            // No storage (private browsing…): shown at every visit.
        }
    }

    /**
     * Shows a message on the map telling that the project has editable
     * layers, unless the user has already sent a request.
     */
    _showNotice() {
        try {
            if (localStorage.getItem(this._noticeKey)) {
                return;
            }
        } catch {
            // No storage: shown at every visit.
        }

        const text = this.querySelector('.edition-access-notice')?.textContent.trim();
        const lizMap = globalThis.lizMap;

        if (!text || typeof lizMap?.addMessage !== 'function') {
            return;
        }

        const message = lizMap.addMessage(text, 'info', true);
        const link = document.createElement('a');

        link.href = '#';
        link.className = 'edition-access-open';
        link.textContent = this.dataset.noticeLink || '';
        link.addEventListener('click', (event) => {
            event.preventDefault();
            message.remove();
            document.querySelector('#mapmenu li.edition-access:not(.active) > a')?.click();
        });

        const paragraph = message.get?.(0)?.querySelector('p');
        if (paragraph && link.textContent) {
            paragraph.append(' ', link);
        }
    }

    /**
     * Sends the request for access to the administrators.
     */
    async _send() {
        const button = this._form.querySelector('.edition-access-send');
        const data = new FormData(this._form);

        data.set('repository', this.dataset.repository);
        data.set('project', this.dataset.project);

        button.disabled = true;
        this._showResult(this.dataset.sending, '');

        try {
            const response = await fetch(this.dataset.url, {
                method: 'POST',
                body: data,
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            const json = await response.json();

            // Sent, or already sent in the last 24 hours: no more notice.
            if (json.status === 'sent' || response.status === 429) {
                this._dismissNotice();
            }

            if (json.status === 'sent') {
                this._showResult(json.message, 'success');
                this._form.hidden = true;
            } else {
                this._showResult(json.message, 'error');
                button.disabled = false;
            }
        } catch (error) {
            console.error('Edition access request:', error);
            this._showResult(this.dataset.networkError, 'error');
            button.disabled = false;
        }
    }

    /**
     * Shows the progress or the answer of the request.
     * @param {string} text - Text of the message
     * @param {string} type - '' (in progress), 'success' or 'error'
     */
    _showResult(text, type) {
        if (!this._result) {
            return;
        }
        this._result.textContent = text || '';
        this._result.classList.toggle('text-success', type === 'success');
        this._result.classList.toggle('text-error', type === 'error');
    }
}
