/**
 * @module components/Treeview.js
 * @name Treeview
 * @copyright 2023 3Liz
 * @author BOISTEAULT Nicolas
 * @license MPL-2.0
 */

import { mainLizmap, mainEventDispatcher } from '../modules/Globals.js';
import { Utils } from '../modules/Utils.js';
import { MapLayerLoadStatus } from '../modules/state/MapLayer.js';
import { moveTreeItem } from '../modules/state/LayerTree.js';
import { MEDIA_REGEX } from '../utils/Constants.js';

import { html, render } from 'lit-html';

/**
 * @class
 * @name Treeview
 * @augments HTMLElement
 */
export default class Treeview extends HTMLElement {
    constructor() {
        super();
        this._itemNameSelected;
        this._clickTimestamp;
        this._activeLabelNames = new Set();
        this._lastClickedLabelName;
        // Drag and drop reordering (QGIS layer panel style)
        this._draggedItem = null;
        this._dragOverEl = null;
        this._dragOverPosition = null;
        // Context menu (right-click) on a layer
        this._contextMenuItem = null;
        this._contextMenuX = 0;
        this._contextMenuY = 0;
        this._onContextMenuOutsideEvent = () => this._closeContextMenu();
        this._onContextMenuKeydown = (e) => {
            if (e.key === 'Escape') {
                this._closeContextMenu();
            }
        };
    }

    connectedCallback() {

        this._onChange = () => {
            if (this._freeze) return;
            render(this._rootTemplate(mainLizmap.state.layerTree), this);
        };

        this._olLayerTemplate = (olLayer) =>
            html`
        <li data-testid="ol-${olLayer.name}">
            <div class="${olLayer.checked ? 'checked' : ''} ${olLayer.type}">
                <div class="loading ${olLayer.loadStatus === MapLayerLoadStatus.Loading ? 'spinner' : ''}"></div>
                <input type="checkbox" id="node-ol-${olLayer.name}" .checked=${olLayer.checked} @click=${() => olLayer.checked = !olLayer.checked} >
                <div class="node ${olLayer.isFiltered ? 'filtered' : ''}">
                    <img class="legend" src="${olLayer.icon}">
                    <label for="node-ol-${olLayer.name}">${olLayer.wmsTitle}</label>
                    <div class="layer-actions">
                    </div>
                </div>
            </div>
        </li>`

        this._extGroupTemplate = (extGroup) =>
            html`
        <li data-testid="ext-${extGroup.name}">
            <div class="expandable ${extGroup.expanded ? 'expanded' : ''}" @click=${() => extGroup.expanded = !extGroup.expanded}></div>
            <div class="${extGroup.checked ? 'checked' : ''} ${extGroup.type} group">
                <div class="node">
                    <label for="node-ext-${extGroup.name}">${extGroup.wmsTitle}</label>
                    <div class="layer-actions">
                    </div>
                </div>
            </div>
            <ul>
                ${extGroup.children.map(item => html`
                    ${this._olLayerTemplate(item)}
                `)}
            </ul>
        </li>`

        this._symbolImageTemplate = symbol =>
            html`
        <label class="symbol-title">
            <img class="legend" alt="${symbol.title}" src="${this._createGetMediaLink(symbol.url)}">
        </label>`

        this._symbolIconTemplate = symbol =>
            html`
        <label class="symbol-title">
            ${symbol.ruleKey
                ? html`
                    <input type="checkbox" .checked=${symbol.checked} @click=${() => symbol.checked = !symbol.checked}>
                    <span class="svg-icon svg-eye-toggle ${symbol.checked ? 'checked' : ''}"
                        @click=${(e) => { e.preventDefault(); e.stopPropagation(); symbol.checked = !symbol.checked; }}></span>`
                : ''
            }
            <img class="legend" src="${symbol.icon}">
            ${symbol.title}
        </label>
        ${(symbol.childrenCount)
            ? html`
                    <ul class="symbols">
                        ${symbol.children.map(s => this._symbolTemplate(s))}
                    </ul>`
                : ''
        }
        `

        this._symbolTemplate = symbol =>
            html`
        <li class="symbol ${symbol.type}${this._isInScale(symbol) ? '' : ' not-in-scale'}${symbol.ruleKey && !symbol.checked ? ' not-visible' : ''}">
            ${(symbol.childrenCount)
                ? html`
                        <div class="expandable ${symbol.expanded ? 'expanded' : ''}" @click=${() => symbol.expanded = !symbol.expanded}></div>`
                    : ''
            }
            ${symbol.type === 'image' ? html`${this._symbolImageTemplate(symbol)}` : ''}
            ${symbol.type !== 'image' ? html`${this._symbolIconTemplate(symbol)}` : ''}
        </li>`

        this._layerTemplate = (layer, parent) =>
            html`
        <li data-testid="${layer.name}" class="${this._isVisible(layer) ? '' : 'not-visible'}">
            ${layer.symbologyChildrenCount && layer.layerConfig.legendImageOption !== "disabled"
                ? html`<div class="expandable ${layer.expanded ? 'expanded' : ''}" @click=${() => layer.expanded = !layer.expanded}></div>`
                : ''
            }
            <div class="${layer.checked ? 'checked' : ''} ${layer.type} ${layer.name === this._itemNameSelected ? 'selected' : ''}">
                <div class="loading ${layer.loadStatus === MapLayerLoadStatus.Loading ? 'spinner' : ''}"></div>
                <input type="checkbox"
                    class="${parent.mutuallyExclusive ? 'rounded-checkbox' : ''}"
                    id="node-${layer.name}"
                    .checked=${layer.checked}
                    @click=${() => layer.checked = !layer.checked} >
                ${!parent.mutuallyExclusive
                    ? html`<span class="svg-icon svg-eye-toggle ${layer.checked ? 'checked' : ''}"
                        @click=${(e) => { e.preventDefault(); e.stopPropagation(); layer.checked = !layer.checked; }}></span>`
                    : ''
                }
                <div class="node ${layer.isFiltered ? 'filtered' : ''} ${this._activeLabelNames.has(layer.name) ? 'active-layer' : ''}"
                    draggable="true"
                    @dragstart=${(e) => this._onDragStart(e, layer)}
                    @dragover=${(e) => this._onDragOver(e, layer)}
                    @dragleave=${(e) => this._onDragLeave(e)}
                    @drop=${(e) => this._onDrop(e, layer)}
                    @dragend=${() => this._onDragEnd()}
                    @contextmenu=${(e) => this._openContextMenu(e, layer)}>
                    <img class="legend" src="${layer.icon}">
                    <label for="node-${layer.name}" data-select-name="${layer.name}" @click=${(e) => this._selectActiveLabel(e, layer.name)}>${layer.layerConfig.title}</label>
                    <div class="layer-actions">
                        <a href="${this._createDocLink(layer.name)}" target="_blank" title="${lizDict['tree.button.link']}">
                            <i class="icon-share"></i>
                        </a>
                        ${layer.layerConfig.cached
                            ? html`
                                <a href="${this._createRemoveCacheLink(layer.name)}" target="_blank">
                                    <i class="icon-remove-sign" title="${lizDict['tree.button.removeCache']}" @click=${event => this._removeCache(event)}></i>
                                </a>`
                            : ''
                        }
                        <i class="icon-info-sign" @click=${() => this.itemNameSelected = layer.name}></i>
                    </div>
                </div>
            </div>
            ${(layer.symbologyChildrenCount && layer.layerConfig.legendImageOption !== "disabled")
                ? html`
                    <ul class="symbols">
                        ${layer.symbologyChildren.map(symbol => this._symbolTemplate(symbol))}
                    </ul>`
                : ''
            }
        </li>`

        this._groupTemplate = (group, parent) =>
            html`
        <li data-testid="${group.name}" class="${this._isVisible(group) ? '' : 'not-visible'}">
            <div class="expandable ${group.expanded ? 'expanded' : ''}" @click=${() => group.expanded = !group.expanded}></div>
            <div class="${group.checked ? 'checked' : ''} ${group.type} ${group.name === this._itemNameSelected ? 'selected' : ''}">
                ${mainLizmap.initialConfig.options.hideGroupCheckbox
                    ? ''
                    : html`<input type="checkbox" class="${parent.mutuallyExclusive ? 'rounded-checkbox' : ''}"
                      id="node-${group.name}"
                      .checked=${group.checked}
                      @click=${(evt) => this._clickItem(evt, group)}
                      @dblclick=${() => this._dblclickItem(group)} >`
                }
                ${(!mainLizmap.initialConfig.options.hideGroupCheckbox && !parent.mutuallyExclusive)
                    ? html`<span class="svg-icon svg-eye-toggle ${group.checked ? 'checked' : ''}"
                        @click=${(evt) => { evt.preventDefault(); evt.stopPropagation(); this._clickItem(evt, group); }}
                        @dblclick=${() => this._dblclickItem(group)}></span>`
                    : ''
                }
                <div class="node ${group.isFiltered ? 'filtered' : ''} ${this._activeLabelNames.has(group.name) ? 'active-layer' : ''}"
                    draggable="true"
                    @dragstart=${(e) => this._onDragStart(e, group)}
                    @dragover=${(e) => this._onDragOver(e, group)}
                    @dragleave=${(e) => this._onDragLeave(e)}
                    @drop=${(e) => this._onDrop(e, group)}
                    @dragend=${() => this._onDragEnd()}>
                    ${mainLizmap.initialConfig.options.hideGroupCheckbox
                        ? html`<label for="node-${group.name}" data-select-name="${group.name}" @click=${(e) => this._selectActiveLabel(e, group.name)}>${group.layerConfig.title}</label>`
                        : html`<label
                          for="node-${group.name}"
                          data-select-name="${group.name}"
                          @click=${(e) => this._selectActiveLabel(e, group.name)}
                          @dblclick=${() => this._dblclickItem(group)} } >${group.layerConfig.title}</label>`
                    }
                    <div class="layer-actions">
                        <a href="${this._createDocLink(group.name)}" target="_blank" title="${lizDict['tree.button.link']}">
                            <i class="icon-share"></i>
                        </a>
                        ${group.layerConfig.cached
                            ? html`
                                <a href="${this._createRemoveCacheLink(group.name)}" target="_blank">
                                    <i class="icon-remove-sign" title="${lizDict['tree.button.removeCache']}" @click=${event => this._removeCache(event)}></i>
                                </a>`
                            : ''
                        }
                        <i class="icon-info-sign" @click=${() => this.itemNameSelected = group.name}></i>
                    </div>
                </div>
            </div>
            <ul>
                ${group.children.map(item => html`
                    ${item.type === 'group' ? html`${this._groupTemplate(item, group)}` : ''}
                    ${item.type === 'layer' ? html`${this._layerTemplate(item, group)}` : ''}
                `)}
            </ul>
        </li>`

        this._contextMenuTemplate = () => {
            if (!this._contextMenuItem) {
                return '';
            }
            const item = this._contextMenuItem;
            // "Compare layer" only shows for a layer (not a group).
            const canCompare = this._isLayerName(item.name);
            return html`
        <ul class="contextmenu" style="left:${this._contextMenuX}px; top:${this._contextMenuY}px;">
            <li class="contextmenu-zoom-layer" @click=${() => this._onContextMenuZoomToLayer(item)}>
                <span class="svg-icon svg-zoom-layer" aria-hidden="true"></span>${lizDict['tree.contextmenu.zoomToLayer']}</li>
            ${canCompare
                ? html`<li class="contextmenu-compare-layer" @click=${() => this._onContextMenuCompareLayer(item)}>
                    <span class="svg-icon svg-compare-layer" aria-hidden="true"></span>${lizDict['tree.contextmenu.compareLayer']}</li>`
                : ''
            }
        </ul>`;
        }

        this._rootTemplate = layerTreeRoot =>
            html`
        <ul
            @dragover=${(e) => this._onRootDragOver(e)}
            @dragleave=${(e) => this._onRootDragLeave(e)}
            @drop=${(e) => this._onRootDrop(e)}>
            ${layerTreeRoot.children.map(item => html`
                ${item.type === 'group' ? html`${this._groupTemplate(item, layerTreeRoot)}` : ''}
                ${item.type === 'layer' ? html`${this._layerTemplate(item, layerTreeRoot)}` : ''}
                ${item.type === 'ext-group' && item.childrenCount ? html`${this._extGroupTemplate(item)}` : ''}
            `)}
        </ul>
        ${this._contextMenuTemplate()}`;

        render(this._rootTemplate(mainLizmap.state.layerTree), this);

        // Disable the browser's native context menu on the layer panel
        // so our own context menu can be shown instead.
        this._onContextMenu = (e) => e.preventDefault();
        this.addEventListener('contextmenu', this._onContextMenu);

        mainLizmap.state.layerTree.addListener(
            this._onChange,
            [
                'layer.load.status.changed', 'layer.visibility.changed', 'group.visibility.changed', 'layer.style.changed',
                'layer.symbology.changed', 'layer.filter.changed', 'layer.expanded.changed', 'group.expanded.changed',
                'layer.symbol.expanded.changed', 'ol-layer.added', 'ext-group.expanded.changed', 'ol-layer.removed', 'ext-group.removed',
                'layer.visibility.changed', 'ol-layer.visibility.changed', 'ext-group.visibility.changed',
                'ol-layer.wmsTitle.changed', 'ol-layer.icon.changed', 'ext-group.wmsTitle.changed',
            ]
        );

        mainEventDispatcher.addListener(
            this._onChange, ['resolution.changed']
        );

        // layertree has been created, fire corresponding event
        mainLizmap.lizmap3.events.triggerEvent('treecreated');
    }

    disconnectedCallback() {
        this.removeEventListener('contextmenu', this._onContextMenu);
        document.removeEventListener('click', this._onContextMenuOutsideEvent);
        document.removeEventListener('contextmenu', this._onContextMenuOutsideEvent);
        document.removeEventListener('keydown', this._onContextMenuKeydown);

        mainLizmap.state.layerTree.removeListener(
            this._onChange,
            [
                'ext-group.expanded.changed',
                'ext-group.visibility.changed',
                'group.expanded.changed',
                'group.visibility.changed',
                'layer.expanded.changed',
                'layer.filter.changed',
                'layer.load.status.changed',
                'layer.style.changed',
                'layer.symbol.expanded.changed',
                'layer.symbology.changed',
                'layer.visibility.changed',
                'ol-layer.visibility.changed',
            ]
        );

        mainEventDispatcher.removeListener(
            this._onChange, ['resolution.changed']
        );
    }

    set itemNameSelected(itemName) {
        if (this._itemNameSelected === itemName) {
            this._itemNameSelected = undefined;
        } else {
            this._itemNameSelected = itemName;
        }

        lizMap.events.triggerEvent("lizmapswitcheritemselected",
            { 'name': itemName, 'selected': this._itemNameSelected !== undefined }
        );

        this._onChange();
    }

    _isVisible(item) {
        if (item.type === 'group') {
            return item.visibility;
        }
        const metersPerUnit = mainLizmap.map.getView().getProjection().getMetersPerUnit();
        const scale = Utils.getScaleFromResolution(mainLizmap.map.getView().getResolution(), metersPerUnit);
        const visibility = item.isVisible(scale);
        return visibility;
    }

    _isInScale(symbol) {
        if (symbol.minScaleDenominator !== undefined && symbol.maxScaleDenominator !== undefined
            && symbol.maxScaleDenominator > symbol.minScaleDenominator){
            const metersPerUnit = mainLizmap.map.getView().getProjection().getMetersPerUnit();
            const scale = Utils.getScaleFromResolution(mainLizmap.map.getView().getResolution(), metersPerUnit);
            return symbol.minScaleDenominator < scale
            && scale < symbol.maxScaleDenominator;
        }
        return true;
    }

    _clickItem(evt, item) {
        // Freeze or dblclick received
        if (this._freeze || evt.detail > 1) {
            // Force input element to keep checked status
            evt.currentTarget.checked = item.checked;
            return false;
        }

        // It is much more end2end test purpose
        // a playwright dblclick is 2 clicks with detail 0
        // and the dblclick which is a click with detail 2
        if (this._clickTimestamp && evt.timeStamp - this._clickTimestamp < 1) {
            // Force input element to keep checked status
            evt.currentTarget.checked = item.checked;
            return false;
        }
        this._clickTimestamp = evt.timeStamp;

        item.checked = !item.checked;
        return false;
    }

    _selectActiveLabel(e, name) {
        // Click on a label (layer or group): selects it as "active"
        // instead of toggling the checkbox via the native label/checkbox
        // association (QGIS-like: click = select, Ctrl/Cmd = toggle,
        // Shift = range).
        e.preventDefault();
        e.stopPropagation();

        this._applySelectionClick(e, name, { replaceWhenUnselected: true });

        this._onChange();
    }

    // Shared selection logic between the plain left click
    // (_selectActiveLabel) and the right click (_openContextMenu).
    // `replaceWhenUnselected` is the only difference: a left click
    // without a modifier always replaces the selection; a right click
    // without a modifier only replaces it if the item wasn't already
    // selected, so right-clicking inside an existing multi-selection
    // doesn't shrink it.
    _applySelectionClick(e, name, { replaceWhenUnselected }) {

        if (e.shiftKey && this._lastClickedLabelName) {

            const orderedNames = this._getOrderedSelectableLabelNames();
            const anchorIndex = orderedNames.indexOf(this._lastClickedLabelName);
            const currentIndex = orderedNames.indexOf(name);

            if (anchorIndex === -1 || currentIndex === -1) {
                this._activeLabelNames = new Set([name]);
                this._lastClickedLabelName = name;
            } else {
                const start = Math.min(anchorIndex, currentIndex);
                const end = Math.max(anchorIndex, currentIndex);
                this._activeLabelNames = new Set(orderedNames.slice(start, end + 1));
                // The anchor doesn't move: the next Shift+click always
                // starts from the same point.
            }

        } else if (e.ctrlKey || e.metaKey) {

            if (this._activeLabelNames.has(name)) {
                this._activeLabelNames.delete(name);
            } else {
                this._activeLabelNames.add(name);
            }
            this._lastClickedLabelName = name;

        } else if (replaceWhenUnselected || !this._activeLabelNames.has(name)) {

            this._activeLabelNames = new Set([name]);
            this._lastClickedLabelName = name;

        }
        // else: right click without modifier on an already-selected
        // item -> selection stays as-is.
    }

    _getOrderedSelectableLabelNames() {
        // Visual (DOM) order of the selectable layer/group labels,
        // excluding ones hidden by a collapsed parent group.
        return Array.from(this.querySelectorAll('label[data-select-name]'))
            .filter(el => el.offsetParent !== null)
            .map(el => el.dataset.selectName);
    }

    // --- Drag and drop reordering (QGIS layer panel style) ---
    //
    // A layer or group can be dropped above/below another item, inside
    // a group, or in the root zone. Hover feedback is CSS classes
    // toggled directly on the DOM (not a lit-html re-render, which
    // would break the HTML5 drag session on some browsers); the
    // re-render only happens on `drop`.

    _onDragStart(e, item) {
        if (this._freeze) {
            e.preventDefault();
            return;
        }
        e.stopPropagation();
        this._draggedItem = item;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.name);
        const li = e.currentTarget.closest('li');
        if (li) {
            li.classList.add('dragging');
        }
    }

    _isAncestorGroup(possibleAncestor, item) {
        let current = item;
        while (current) {
            if (current === possibleAncestor) {
                return true;
            }
            current = current.parentGroupState;
        }
        return false;
    }

    _clearDragOverIndicator() {
        if (this._dragOverEl) {
            this._dragOverEl.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
            this._dragOverEl = null;
        }
        this._dragOverPosition = null;
    }

    _onDragOver(e, item) {
        if (!this._draggedItem || this._draggedItem === item) {
            return;
        }
        // Forbid dropping a group onto itself or one of its own
        // descendants (not calling preventDefault() here disables the
        // drop on this target: the browser cursor shows "forbidden").
        if (this._draggedItem.type === 'group' && this._isAncestorGroup(this._draggedItem, item)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const rect = e.currentTarget.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        let position;
        if (item.type === 'group' && relY > 0.25 && relY < 0.75) {
            position = 'into';
        } else if (relY <= 0.5) {
            position = 'before';
        } else {
            position = 'after';
        }

        if (this._dragOverEl && this._dragOverEl !== e.currentTarget) {
            this._clearDragOverIndicator();
        }
        this._dragOverEl = e.currentTarget;
        this._dragOverEl.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-into');
        this._dragOverEl.classList.add('drag-over-' + position);
        this._dragOverPosition = position;
    }

    _onDragLeave(e) {
        if (e.currentTarget === this._dragOverEl
            && (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget))) {
            this._clearDragOverIndicator();
        }
    }

    _onDrop(e, item) {
        e.preventDefault();
        e.stopPropagation();
        const draggedItem = this._draggedItem;
        const position = this._dragOverPosition;
        this._clearDragOverIndicator();
        this._draggedItem = null;

        if (!draggedItem || draggedItem === item || !position) {
            return;
        }

        let targetGroup;
        let targetIndex;
        if (position === 'into') {
            targetGroup = item;
            targetIndex = 0;
        } else {
            targetGroup = item.parentGroupState || mainLizmap.state.layerTree;
            const siblingIndex = targetGroup.children.indexOf(item);
            targetIndex = position === 'before' ? siblingIndex : siblingIndex + 1;
        }

        const moved = moveTreeItem(draggedItem, targetGroup, targetIndex);
        if (moved) {
            this._onChange();
            if (mainLizmap.map && typeof mainLizmap.map.updateLayersZIndex === 'function') {
                mainLizmap.map.updateLayersZIndex();
            }
        }
    }

    _onDragEnd() {
        this._clearDragOverIndicator();
        this._draggedItem = null;
        // Safety net: clean up the "dragging" class even if the drop
        // happened outside a valid target.
        this.querySelectorAll('li.dragging').forEach(el => el.classList.remove('dragging'));
    }

    _onRootDragOver(e) {
        if (!this._draggedItem) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drag-over-root');
    }

    _onRootDragLeave(e) {
        e.currentTarget.classList.remove('drag-over-root');
    }

    _onRootDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over-root');
        const draggedItem = this._draggedItem;
        this._draggedItem = null;
        if (!draggedItem) {
            return;
        }

        const root = mainLizmap.state.layerTree;
        const moved = moveTreeItem(draggedItem, root, root.childrenCount);
        if (moved) {
            this._onChange();
            if (mainLizmap.map && typeof mainLizmap.map.updateLayersZIndex === 'function') {
                mainLizmap.map.updateLayersZIndex();
            }
        }
    }

    // Moves `item` to the top of the layer tree root, updating every
    // layer's zIndex from the new tree order. Shortcut around
    // moveItemToPosition() below, used by the comparison tool.
    moveItemToRootTop(item) {
        return this.moveItemToPosition(item, mainLizmap.state.layerTree, 0);
    }

    // Moves `item` to `targetGroup` at `targetIndex` (same mechanics as
    // drag and drop, see _onDrop()/_onRootDrop() above), updating the
    // zIndex from the new tree order. Exposed on this custom element so
    // ComparisonSlider.js can reorder the tree without importing
    // LayerTree.js.
    moveItemToPosition(item, targetGroup, targetIndex) {
        const moved = moveTreeItem(item, targetGroup, targetIndex);
        if (moved) {
            this._onChange();
            if (mainLizmap.map && typeof mainLizmap.map.updateLayersZIndex === 'function') {
                mainLizmap.map.updateLayersZIndex();
            }
        }
        return moved;
    }

    // --- Context menu (right-click) on a layer ---
    //
    // Entries: "Zoom to layer" (layers and groups) and, for a layer
    // only, "Compare layer". See _contextMenuTemplate() above.

    _openContextMenu(e, item) {
        e.preventDefault();
        e.stopPropagation();
        // Keeps/extends the current selection instead of shrinking it
        // to this single item if others were already selected.
        this._applySelectionClick(e, item.name, { replaceWhenUnselected: false });
        this._contextMenuItem = item;
        this._contextMenuX = e.clientX;
        this._contextMenuY = e.clientY;
        this._onChange();
        // Added on the next tick so the click that opened the menu
        // isn't also caught as an "outside click".
        window.setTimeout(() => {
            document.addEventListener('click', this._onContextMenuOutsideEvent);
            document.addEventListener('contextmenu', this._onContextMenuOutsideEvent);
            document.addEventListener('keydown', this._onContextMenuKeydown);
        }, 0);
    }

    _closeContextMenu() {
        if (!this._contextMenuItem) {
            return;
        }
        this._contextMenuItem = null;
        document.removeEventListener('click', this._onContextMenuOutsideEvent);
        document.removeEventListener('contextmenu', this._onContextMenuOutsideEvent);
        document.removeEventListener('keydown', this._onContextMenuKeydown);
        this._onChange();
    }

    // "Zoom to layer" entry: zooms to the layer/group's WMS geographic
    // bounding box (EPSG:4326), see map.js:zoomToGeographicBoundingBox().
    _onContextMenuZoomToLayer(item) {
        this._closeContextMenu();
        if (mainLizmap.map && typeof mainLizmap.map.zoomToGeographicBoundingBox === 'function') {
            mainLizmap.map.zoomToGeographicBoundingBox(item.wmsGeographicBoundingBox);
        }
    }

    // True if `name` is a layer (not a group) currently rendered in
    // the tree, checked from the DOM's own layer/group CSS class.
    _isLayerName(name) {
        const li = this.querySelector(`li[data-testid="${CSS.escape(name)}"]`);
        return !!(li && li.querySelector(':scope > div.layer'));
    }

    // "Compare layer" entry: starts (or restarts) the swipe comparison
    // tool on `item` (see modules/ComparisonSlider.js).
    _onContextMenuCompareLayer(item) {
        this._closeContextMenu();
        if (mainLizmap.comparisonSlider) {
            mainLizmap.comparisonSlider.compareSingleLayer(item.name);
        }
    }

    _dblclickItem(item) {
        if (item.type != 'group') {
            return false;
        }

        if (this._freeze) {
            return false;
        }

        this._freeze = true;
        item.propagateCheckedState(item.checked);
        this._freeze = false;
        this._onChange();
        return false;
    }

    _createGetMediaLink(path) {
        let url;
        // Test if the path is internal
        if (MEDIA_REGEX.test(path)) {
            const mediaLink = globalThis['lizUrls'].media + '?' + new URLSearchParams(globalThis['lizUrls'].params);
            url = mediaLink + '&path=/' + path;
        } else {
            url = path;
        }
        return url;
    }

    _createDocLink(layerName) {
        let url = lizMap.config.layers?.[layerName]?.link;
        return this._createGetMediaLink(url);
    }

    _createRemoveCacheLink(layerName) {
        if(!globalThis['lizUrls'].removeCache){
            return;
        }
        const removeCacheServerUrl = globalThis['lizUrls'].removeCache + '?' + new URLSearchParams(globalThis['lizUrls'].params);
        return removeCacheServerUrl + '&layer=' + layerName;
    }

    _removeCache(event) {
        if (! confirm(lizDict['tree.button.removeCache.confirmation'])){
            event.preventDefault();
        }
    }
}
