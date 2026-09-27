/**
 * @module modules/ComparisonSlider.js
 * @name ComparisonSlider
 * @copyright 2026 S.Poudroux / Kheper 3D
 * @license MPL-2.0
 */

/**
 * Swipe/compare tool for a single map layer.
 *
 * The selected layer is moved to the top of the layer tree (and
 * therefore to the top z-index) while all other layers stay visible
 * and unchanged. Only the selected layer is clipped on either side of
 * the swipe cursor (horizontal or vertical, detected from the first
 * drag with the middle mouse button). Escape restores the layer to
 * its original position (parent group + index) and checked state.
 *
 * @class
 * @name ComparisonSlider
 */
export default class ComparisonSlider {

    /**
     * @param {object} map       - The Lizmap map module instance (mainLizmap.map)
     * @param {object} layerTree - Root layer tree state (mainLizmap.state.layerTree)
     */
    constructor(map, layerTree) {
        this._map = map;
        this._layerTree = layerTree;

        this._swipePosition = 50;
        this._swipeDragging = false;
        this._swipeMode = null;
        // True between the middle-button mousedown and the axis being
        // re-detected from the drag (see _moveSwipeDrag). While true,
        // _swipeMode keeps its current value instead of falling back
        // to an unclipped full-screen render.
        this._swipeModePending = false;
        this._swipeStartPoint = { x: 0, y: 0 };

        // Compared layer: Lizmap layer-tree state (for moving/restoring
        // it) and the matching OpenLayers layer (for pre/postrender clip).
        this._swipeItem = null;
        this._swipeItemName = null;
        this._olLayerSwipe = null;

        // Original position (parent group + index) and checked state,
        // saved once before any move, for exact restoration on close.
        this._swipeSavedParentGroup = null;
        this._swipeSavedIndex = null;
        this._swipeSavedChecked = null;

        this._swipeActive = false;

        // Bound once so the same function reference can be used to
        // add and remove these listeners.
        this._startSwipeDrag = this._startSwipeDrag.bind(this);
        this._moveSwipeDrag = this._moveSwipeDrag.bind(this);
        this._stopSwipeDrag = this._stopSwipeDrag.bind(this);
        this._swipePreRender = this._swipePreRender.bind(this);
        this._swipePostRender = this._swipePostRender.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);

        document.addEventListener('keydown', this._onKeyDown);
    }

    _getSwipeMap() {
        return this._map;
    }

    _findOlLayer(layerName) {
        const map = this._getSwipeMap();
        if (!map) {
            return null;
        }

        function search(collection) {
            const layers = collection.getArray();
            for (const layer of layers) {
                if (layer.getLayers && typeof layer.getLayers === 'function') {
                    const found = search(layer.getLayers());
                    if (found) {
                        return found;
                    }
                    continue;
                }
                const name = layer.get('name');
                const title = layer.get('title');
                const layerNameProperty = layer.get('layerName');
                if (name === layerName || title === layerName || layerNameProperty === layerName) {
                    return layer;
                }
            }
            return null;
        }

        return search(map.getLayers());
    }

    _removeSwipeRenderEvents() {
        if (this._olLayerSwipe) {
            this._olLayerSwipe.un('prerender', this._swipePreRender);
            this._olLayerSwipe.un('postrender', this._swipePostRender);
        }
    }

    _getSwipePixelRatio(event) {
        if (event && event.frameState && event.frameState.pixelRatio) {
            return event.frameState.pixelRatio;
        }
        return window.devicePixelRatio || 1;
    }

    _swipePreRender(event) {
        if (!event.context) {
            return;
        }
        const ctx = event.context;
        const map = this._getSwipeMap();
        const size = map.getSize();
        if (!size) {
            return;
        }
        const pixelRatio = this._getSwipePixelRatio(event);
        const width = size[0] * pixelRatio;
        const height = size[1] * pixelRatio;

        ctx.save();
        ctx.beginPath();

        // The compared layer covers the left part (horizontal) or top
        // part (vertical); the rest of the map stays visible since no
        // other layer is ever hidden.
        if (this._swipeMode === 'horizontal') {
            const x = this._swipePosition / 100 * width;
            ctx.rect(0, 0, x, height);
        } else if (this._swipeMode === 'vertical') {
            const y = this._swipePosition / 100 * height;
            ctx.rect(0, 0, width, y);
        } else {
            ctx.rect(0, 0, width, height);
        }

        ctx.clip();
    }

    _swipePostRender(event) {
        if (event.context) {
            event.context.restore();
        }
    }

    _createSwipeBars() {
        const mapElement = this._getSwipeMap().getTargetElement();
        if (!mapElement) {
            return;
        }

        this._removeSwipeBars();

        if (window.getComputedStyle(mapElement).position === 'static') {
            mapElement.style.position = 'relative';
        }

        const verticalBar = document.createElement('div');
        verticalBar.id = 'lizmap-swipe-vertical-bar';

        const horizontalBar = document.createElement('div');
        horizontalBar.id = 'lizmap-swipe-horizontal-bar';

        verticalBar.style.left = '50%';
        horizontalBar.style.top = '50%';

        // Visible immediately on the current axis (this._swipeMode is
        // already set by _startSwipeSession before this call).
        if (this._swipeMode === 'horizontal') {
            verticalBar.style.display = 'block';
            horizontalBar.style.display = 'none';
            document.body.classList.add('swipe-horizontal');
            document.body.classList.remove('swipe-vertical');
        } else {
            horizontalBar.style.display = 'block';
            verticalBar.style.display = 'none';
            document.body.classList.add('swipe-vertical');
            document.body.classList.remove('swipe-horizontal');
        }

        mapElement.appendChild(verticalBar);
        mapElement.appendChild(horizontalBar);
    }

    _removeSwipeBars() {
        const vertical = document.getElementById('lizmap-swipe-vertical-bar');
        const horizontal = document.getElementById('lizmap-swipe-horizontal-bar');
        if (vertical) {
            vertical.remove();
        }
        if (horizontal) {
            horizontal.remove();
        }
    }

    _startSwipeDrag(event) {
        // Only the middle mouse button starts a swipe.
        if (event.button !== 1) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        this._swipeDragging = true;
        // _swipeMode is NOT reset here: rendering stays clipped on the
        // current axis until _moveSwipeDrag decides, from an actual
        // movement, whether to switch axis.
        this._swipeModePending = true;
        this._swipeStartPoint = { x: event.clientX, y: event.clientY };

        // Prevents OpenLayers from starting its own drag interaction.
        const mapElement = this._getSwipeMap().getTargetElement();
        mapElement.classList.add('swipe-dragging');
    }

    _moveSwipeDrag(event) {
        if (!this._swipeDragging) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();

        const map = this._getSwipeMap();
        const viewport = map.getViewport();
        const rect = viewport.getBoundingClientRect();
        const size = map.getSize();
        if (!size) {
            return;
        }

        const dx = event.clientX - this._swipeStartPoint.x;
        const dy = event.clientY - this._swipeStartPoint.y;

        if (this._swipeModePending) {
            // Wait for a minimum movement before choosing the axis.
            if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
                return;
            }
            this._swipeMode = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
            this._swipeModePending = false;
        }

        if (this._swipeMode === 'horizontal') {
            const scaleX = size[0] / rect.width;
            let splitX = (event.clientX - rect.left) * scaleX;
            splitX = Math.max(0, Math.min(splitX, size[0]));
            this._swipePosition = (splitX / size[0]) * 100;

            const verticalBar = document.getElementById('lizmap-swipe-vertical-bar');
            const horizontalBar = document.getElementById('lizmap-swipe-horizontal-bar');
            if (verticalBar) {
                verticalBar.style.display = 'block';
                verticalBar.style.left = splitX / scaleX + 'px';
            }
            if (horizontalBar) {
                horizontalBar.style.display = 'none';
            }

            document.body.classList.add('swipe-horizontal');
            document.body.classList.remove('swipe-vertical');
        } else {
            const scaleY = size[1] / rect.height;
            let splitY = (event.clientY - rect.top) * scaleY;
            splitY = Math.max(0, Math.min(splitY, size[1]));
            this._swipePosition = (splitY / size[1]) * 100;

            const verticalBar = document.getElementById('lizmap-swipe-vertical-bar');
            const horizontalBar = document.getElementById('lizmap-swipe-horizontal-bar');
            if (horizontalBar) {
                horizontalBar.style.display = 'block';
                horizontalBar.style.top = splitY / scaleY + 'px';
            }
            if (verticalBar) {
                verticalBar.style.display = 'none';
            }

            document.body.classList.add('swipe-vertical');
            document.body.classList.remove('swipe-horizontal');
        }

        const mapContent = document.getElementById('map-content');
        if (mapContent) {
            mapContent.style.cursor = this._swipeMode === 'horizontal' ? 'e-resize' : 'n-resize';
        }

        this._swipeStartPoint = { x: event.clientX, y: event.clientY };

        map.render();
    }

    _stopSwipeDrag(event) {
        if (this._swipeDragging && event) {
            event.preventDefault();
        }

        this._swipeDragging = false;
        this._swipeModePending = false;

        const mapElement = this._getSwipeMap()?.getTargetElement();
        if (mapElement) {
            mapElement.classList.remove('swipe-dragging');
        }

        const mapContent = document.getElementById('map-content');
        if (mapContent) {
            mapContent.style.cursor = 'move';
        }
    }

    _registerSwipeMouseEvents() {
        const map = this._getSwipeMap();
        const viewport = map.getViewport();

        // Capture mode intercepts the click before OpenLayers' own
        // interactions handle it.
        viewport.addEventListener('mousedown', this._startSwipeDrag, true);
        viewport.addEventListener('mousemove', this._moveSwipeDrag, true);
        document.addEventListener('mouseup', this._stopSwipeDrag, true);

        viewport._lizmapSwipeMouseDown = this._startSwipeDrag;
        viewport._lizmapSwipeMouseMove = this._moveSwipeDrag;
    }

    _unregisterSwipeMouseEvents() {
        const map = this._getSwipeMap();
        if (!map) {
            return;
        }
        const viewport = map.getViewport();
        viewport.removeEventListener('mousedown', this._startSwipeDrag, true);
        viewport.removeEventListener('mousemove', this._moveSwipeDrag, true);
        document.removeEventListener('mouseup', this._stopSwipeDrag, true);
    }

    _registerSwipeClipEvents() {
        this._removeSwipeRenderEvents();
        if (this._olLayerSwipe) {
            this._olLayerSwipe.on('prerender', this._swipePreRender);
            this._olLayerSwipe.on('postrender', this._swipePostRender);
        }
    }

    _startSwipeSession() {
        this._swipeActive = true;

        // Centered and visible right away so the comparison is
        // understandable without a first drag.
        this._swipePosition = 50;
        this._swipeMode = 'horizontal';

        this._registerSwipeClipEvents();
        this._createSwipeBars();

        this._unregisterSwipeMouseEvents();
        this._registerSwipeMouseEvents();

        const mapContent = document.getElementById('map-content');
        if (mapContent) {
            mapContent.style.cursor = 'move';
        }

        document.body.classList.add('swipe-active');

        this._getSwipeMap().render();

        console.log('Swipe (single layer) activated:', this._swipeItemName);
    }

    /**
     * Moves the layer to the top of the layer tree (and therefore to
     * the top z-index) without hiding any other layer, then starts
     * the swipe session.
     */
    _startSingleLayerSwipe(layerName) {
        const root = this._layerTree;
        let treeItem;

        try {
            treeItem = root.getTreeLayerByName(layerName);
        } catch (e) {
            console.error('ComparisonSlider.compareSingleLayer: layer not found in the layer tree.', layerName);
            return;
        }

        const olLayer = this._findOlLayer(layerName);
        if (!olLayer) {
            console.error('ComparisonSlider.compareSingleLayer: OpenLayers layer not found.', layerName);
            return;
        }

        const treeviewEl = document.querySelector('lizmap-treeview');
        if (!treeviewEl || typeof treeviewEl.moveItemToRootTop !== 'function') {
            console.error('ComparisonSlider.compareSingleLayer: <lizmap-treeview> unavailable, or moveItemToRootTop missing.');
            return;
        }

        // Save the original position (parent group + index) and
        // checked state before moving, for exact restoration on close.
        this._swipeSavedParentGroup = treeItem.parentGroupState || root;
        this._swipeSavedIndex = this._swipeSavedParentGroup.children.indexOf(treeItem);
        this._swipeSavedChecked = treeItem.checked;
        this._swipeItem = treeItem;
        this._swipeItemName = layerName;
        this._olLayerSwipe = olLayer;

        const moved = treeviewEl.moveItemToRootTop(treeItem);
        if (!moved) {
            console.error('ComparisonSlider.compareSingleLayer: failed to move the layer in the tree.', layerName);
            this._swipeItem = null;
            this._swipeItemName = null;
            this._olLayerSwipe = null;
            this._swipeSavedParentGroup = null;
            this._swipeSavedIndex = null;
            this._swipeSavedChecked = null;
            return;
        }

        if (!treeItem.checked) {
            treeItem.checked = true;
        }

        this._startSwipeSession();
    }

    _cleanupSwipe() {
        this._swipeDragging = false;

        this._unregisterSwipeMouseEvents();
        this._removeSwipeRenderEvents();

        // Restore the compared layer to its original position; its
        // z-index is recomputed from the tree order.
        if (this._swipeItem && this._swipeSavedParentGroup) {
            const treeviewEl = document.querySelector('lizmap-treeview');
            if (treeviewEl && typeof treeviewEl.moveItemToPosition === 'function') {
                treeviewEl.moveItemToPosition(this._swipeItem, this._swipeSavedParentGroup, this._swipeSavedIndex);
            }
            if (this._swipeItem.checked !== this._swipeSavedChecked) {
                this._swipeItem.checked = this._swipeSavedChecked;
            }
        }

        this._removeSwipeBars();

        const mapContent = document.getElementById('map-content');
        if (mapContent) {
            mapContent.style.cursor = 'auto';
        }

        document.body.classList.remove('swipe-active');
        document.body.classList.remove('swipe-horizontal');
        document.body.classList.remove('swipe-vertical');

        this._swipeItem = null;
        this._swipeItemName = null;
        this._olLayerSwipe = null;
        this._swipeSavedParentGroup = null;
        this._swipeSavedIndex = null;
        this._swipeSavedChecked = null;
        this._swipeMode = null;
        this._swipeModePending = false;
        this._swipePosition = 50;
        this._swipeActive = false;

        const map = this._getSwipeMap();
        if (map) {
            map.render();
        }

        console.log('Swipe cleaned up.');
    }

    _onKeyDown(event) {
        if (event.key === 'Escape' && this._swipeActive) {
            this._cleanupSwipe();
        }
    }

    /**
     * Compares a single layer, given its name. Called from the layer
     * panel's context menu (see components/Treeview.js).
     */
    compareSingleLayer(layerName) {
        if (!layerName) {
            console.error('ComparisonSlider.compareSingleLayer: missing layer name.');
            return;
        }
        if (this._swipeActive) {
            this._cleanupSwipe();
        }
        this._startSingleLayerSwipe(layerName);
    }
}
