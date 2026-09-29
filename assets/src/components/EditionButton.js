/**
 * @module components/EditionButton.js
 * @name EditionButton
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

/**
 * Edition button of the top bar (template edition_menu), with the QGIS
 * "Toggle Editing" icon: opens or closes the Edition entry of the map
 * menu, which is the edition tool (li.edition) or, when the user cannot
 * edit the layers, the request for access (li.edition-access). The button
 * looks pressed while this entry is open, and dimmed for a request for
 * access.
 * @class
 * @name EditionButton
 * @augments HTMLElement
 */
export default class EditionButton extends HTMLElement {
    constructor() {
        super();

        this._onClick = (event) => {
            event.preventDefault();
            this._target?.querySelector(':scope > a')?.click();
        };
    }

    connectedCallback() {
        this._item = this.closest('.edition-menu-item') || this.parentElement;
        this._button = this._item?.querySelector('.edition-menu-run');
        this._target = document.querySelector('#mapmenu li.edition, #mapmenu li.edition-access');

        if (!this._button) {
            return;
        }

        // No Edition entry in the map menu (embedded map…): no button.
        if (!this._target) {
            this._item.hidden = true;

            return;
        }

        this._button.classList.toggle('edition-menu-locked', this._target.classList.contains('edition-access'));
        this._button.addEventListener('click', this._onClick);

        this._observer = new MutationObserver(() => this._sync());
        this._observer.observe(this._target, { attributes: true, attributeFilter: ['class'] });
        this._sync();
    }

    disconnectedCallback() {
        this._button?.removeEventListener('click', this._onClick);
        this._observer?.disconnect();
    }

    /**
     * Pressed while the Edition entry is open.
     */
    _sync() {
        const active = this._target.classList.contains('active');

        this._button.classList.toggle('active', active);
        this._button.setAttribute('aria-pressed', String(active));
    }
}
