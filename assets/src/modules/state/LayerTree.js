/**
 * @module state/LayerTree.js
 * @name LayerTreeState
 * @copyright 2023 3Liz
 * @author DHONT René-Luc
 * @license MPL-2.0
 */

import EventDispatcher from './../../utils/EventDispatcher.js';
import { LayerConfig } from './../config/Layer.js';
import { AttributionConfig } from './../config/Attribution.js'
import { LayerStyleConfig, LayerGeographicBoundingBoxConfig, LayerBoundingBoxConfig } from './../config/LayerTree.js';
import { MapItemState, MapGroupState, MapLayerState } from './MapLayer.js';
import { ExternalLayerTreeGroupState } from './ExternalLayerTree.js';
import { getDefaultLayerIcon, LayerIconSymbology, LayerSymbolsSymbology, LayerGroupSymbology, SymbolIconSymbology, BaseIconSymbology, BaseSymbolsSymbology } from './Symbology.js';
import { convertBoolean } from './../utils/Converters.js';

/**
 * Class representing a layer tree item
 * @class
 * @augments EventDispatcher
 */
export class LayerTreeItemState extends EventDispatcher {

    /**
     * Instantiate a layer tree item
     * @param {MapItemState}       mapItemState       - the map item state
     * @param {LayerTreeItemState} [parentGroupState] - the parent layer tree group
     */
    constructor(mapItemState, parentGroupState) {
        super();
        this._mapItemState = mapItemState;
        this._parentGroupState = null;

        this._expanded = false;
        if (this.type === "group") {
            this._expanded = true;
        } else {
            this._expanded = this.layerConfig.legendImageOption === "expand_at_startup";
        }

        if (parentGroupState instanceof LayerTreeItemState
            && parentGroupState.type == 'group') {
            this._parentGroupState = parentGroupState;
        }
        if (mapItemState instanceof MapLayerState) {
            mapItemState.addListener(this.dispatch.bind(this), 'layer.visibility.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.symbology.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.opacity.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.loading.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.load.status.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.style.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.symbol.checked.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.symbol.expanded.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.selection.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.selection.token.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.filter.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'layer.filter.token.changed');
        } else if (mapItemState instanceof MapGroupState) {
            mapItemState.addListener(this.dispatch.bind(this), 'group.visibility.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'group.symbology.changed');
            mapItemState.addListener(this.dispatch.bind(this), 'group.opacity.changed');
        }
    }
    /**
     * Config layers
     * @type {string}
     */
    get name() {
        return this._mapItemState.name;
    }

    /**
     * Config layers
     * @type {string}
     */
    get type() {
        return this._mapItemState.type;
    }

    /**
     * Layer tree item level
     * @type {number}
     */
    get level() {
        return this._mapItemState.level;
    }

    /**
     * WMS layer name
     * @type {?string}
     */
    get wmsName() {
        return this._mapItemState.wmsName;
    }

    /**
     * WMS layer title
     * @type {string}
     */
    get wmsTitle() {
        return this._mapItemState.wmsTitle;
    }

    /**
     * WMS layer Geographic Bounding Box
     * @type {?LayerGeographicBoundingBoxConfig}
     */
    get wmsGeographicBoundingBox() {
        return this._mapItemState.wmsGeographicBoundingBox;
    }

    /**
     * WMS layer Bounding Boxes
     * @type {LayerBoundingBoxConfig[]}
     */
    get wmsBoundingBoxes() {
        return this._mapItemState.wmsBoundingBoxes;
    }

    /**
     * WMS Minimum scale denominator
     * If the minimum scale denominator is not defined: -1 is returned
     * If the WMS layer is a group, the minimum scale denominator is -1 if only one layer
     * minimum scale denominator is not defined else the smallest layer minimum scale denominator
     * in the group
     * @type {number}
     */
    get wmsMinScaleDenominator() {
        return this._mapItemState.wmsMinScaleDenominator;
    }

    /**
     * WMS layer maximum scale denominator
     * If the maximum scale denominator is not defined: -1 is returned
     * If the WMS layer is a group, the maximum scale denominator is the largest of the layers in the group
     * @type {number}
     */
    get wmsMaxScaleDenominator() {
        return this._mapItemState.wmsMaxScaleDenominator;
    }

    /**
     * Layer tree item is checked
     * @type {boolean}
     */
    get checked() {
        return this._mapItemState.checked;
    }

    /**
     * Set layer tree item is checked
     * @type {boolean}
     */
    set checked(val) {
        this._mapItemState.checked = val;
    }

    /**
     * Layer tree item is visible
     * It depends on the parent visibility
     * @type {boolean}
     */
    get visibility() {
        return this._mapItemState.visibility;
    }

    /**
     * Layer tree item opacity
     * @type {number}
     */
    get opacity() {
        return this._mapItemState.opacity;
    }

    /**
     * Set layer tree item opacity
     * @type {number}
     */
    set opacity(val) {
        this._mapItemState.opacity = val;
    }

    /**
     * Lizmap layer config
     * @type {?LayerConfig}
     */
    get layerConfig() {
        return this._mapItemState.layerConfig;
    }

    /**
     * Map item state
     * @type {?MapItemState}
     */
    get mapItemState() {
        return this._mapItemState;
    }

    /**
     * Parent layer tree group of this item, or null if it is a root-level item
     * @type {?LayerTreeGroupState}
     */
    get parentGroupState() {
        return this._parentGroupState;
    }

    /**
     * Layer tree item is expanded
     * @type {boolean}
     */
    get expanded() {
        return this._expanded;
    }

    /**
     * Set layer tree item is expanded
     * @type {boolean}
     */
    set expanded(val) {
        const newVal = convertBoolean(val);
        if(this._expanded === newVal){
            return;
        }

        this._expanded = newVal;

        this.dispatch({
            type: this.type + '.expanded.changed',
            name: this.name
        });
    }

    /**
     * Calculate and save visibility
     * @returns {boolean} the calculated visibility
     */
    calculateVisibility() {
        return this._mapItemState.calculateVisibility();
    }

    /**
     * Get item visibility taking care of this.visibility and scale
     * @param {number} scaleDenominator the scale denominator for which the visibility has to be evaluated
     * @returns {boolean} the item visibility
     */
    isVisible(scaleDenominator) {
        if (this.type === 'group') {
            return this.visibility;
        }

        if(this._mapItemState.wmsMinScaleDenominator !== undefined && this._mapItemState.wmsMaxScaleDenominator !== undefined){
            return this.visibility && this._mapItemState.wmsMinScaleDenominator < scaleDenominator
            && scaleDenominator < this._mapItemState.wmsMaxScaleDenominator;
        }
        return this.visibility;
    }
}

/**
 * Class representing a layer tree group
 * @class
 * @augments LayerTreeItemState
 */
export class LayerTreeGroupState extends LayerTreeItemState {

    /**
     * Instantiate a layer tree group
     * @param {MapGroupState}       mapGroupState      - the map layer group state
     * @param {LayerTreeGroupState} [parentGroupState] - the parent layer tree group
     */
    constructor(mapGroupState, parentGroupState) {
        super(mapGroupState, parentGroupState);
        this._items = [];
        for (const mapItemState of mapGroupState.getChildren()) {

            if (mapItemState instanceof MapGroupState) {
                // Build group
                const group = new LayerTreeGroupState(mapItemState, this);
                // If the group is empty do not keep it
                if (group.childrenCount == 0) {
                    continue;
                }
                group.addListener(this.dispatch.bind(this), 'group.visibility.changed');
                group.addListener(this.dispatch.bind(this), 'group.expanded.changed');
                group.addListener(this.dispatch.bind(this), 'group.symbology.changed');
                group.addListener(this.dispatch.bind(this), 'group.opacity.changed');
                group.addListener(this.dispatch.bind(this), 'layer.symbology.changed');
                group.addListener(this.dispatch.bind(this), 'layer.visibility.changed');
                group.addListener(this.dispatch.bind(this), 'layer.expanded.changed');
                group.addListener(this.dispatch.bind(this), 'layer.opacity.changed');
                group.addListener(this.dispatch.bind(this), 'layer.loading.changed');
                group.addListener(this.dispatch.bind(this), 'layer.load.status.changed');
                group.addListener(this.dispatch.bind(this), 'layer.style.changed');
                group.addListener(this.dispatch.bind(this), 'layer.symbol.checked.changed');
                group.addListener(this.dispatch.bind(this), 'layer.symbol.expanded.changed');
                group.addListener(this.dispatch.bind(this), 'layer.selection.changed');
                group.addListener(this.dispatch.bind(this), 'layer.selection.token.changed');
                group.addListener(this.dispatch.bind(this), 'layer.filter.changed');
                group.addListener(this.dispatch.bind(this), 'layer.filter.token.changed');
                this._items.push(group);
            } else if (mapItemState instanceof MapLayerState) {
                if (!mapItemState.displayInLayerTree) {
                    continue;
                }
                // Build layer
                const layer = new LayerTreeLayerState(mapItemState, this)
                layer.addListener(this.dispatch.bind(this), 'layer.visibility.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.expanded.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.symbology.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.opacity.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.loading.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.load.status.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.style.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.symbol.checked.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.symbol.expanded.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.selection.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.selection.token.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.filter.changed');
                layer.addListener(this.dispatch.bind(this), 'layer.filter.token.changed');
                this._items.push(layer);
            }
        }
    }

    /**
     * The layer mutually exclusive activation (group only)
     * @type {boolean}
     */
    get mutuallyExclusive() {
        if (this.layerConfig == null) {
            return false;
        }
        return this.layerConfig.mutuallyExclusive;
    }

    /**
     * Children items count
     * @type {number}
     */
    get childrenCount() {
        return this._items.length;
    }

    /**
     * Children items
     * @type {LayerTreeItemState[]}
     */
    get children() {
        return [...this._items];
    }

    /**
     * Iterate through children items
     * @generator
     * @yields {LayerTreeItemState} The next child item
     */
    *getChildren() {
        for (const item of this._items) {
            yield item;
        }
    }

    /**
     * Propagate throught tree item the new checked state
     * @param {boolean} val The new checked state
     * @returns {boolean} the new checked state
     */
    propagateCheckedState(val) {
        for (const item of this._items) {
            if (item.type == 'group') {
                item.propagateCheckedState(val);
            } else {
                item.checked = val;
            }
            if (item.checked && this.mutuallyExclusive) {
                break;
            }
        }
        this.checked = val;
        return this.checked;
    }

    /**
     * Find layer names
     * @returns {string[]} List of layer names
     */
    findTreeLayerNames() {
        let names = []
        for(const item of this.getChildren()) {
            if (item instanceof LayerTreeLayerState) {
                names.push(item.name);
            } else if (item instanceof LayerTreeGroupState) {
                names = names.concat(item.findTreeLayerNames());
            }
        }
        return names;
    }

    /**
     * Find layer items
     * @returns {LayerTreeLayerState[]}  List of tree layers (not tree groups)
     */
    findTreeLayers() {
        let items = []
        for(const item of this.getChildren()) {
            if (item instanceof LayerTreeLayerState) {
                items.push(item);
            } else if (item instanceof LayerTreeGroupState) {
                items = items.concat(item.findTreeLayers());
            }
        }
        return items;
    }

    /**
     * Find layer and group items
     * @returns {LayerTreeLayerState[]} List of tree layers and tree groups
     */
    findTreeLayersAndGroups() {
        let items = []
        for(const item of this.getChildren()) {
            if (item instanceof LayerTreeLayerState) {
                items.push(item);
            } else if (item instanceof LayerTreeGroupState) {
                items.push(item);
                items = items.concat(item.findTreeLayersAndGroups());
            }
        }
        return items;
    }

    /**
     * Get tree layer item by its name
     * @param {string} name - the layer name
     * @returns {LayerTreeLayerState} The LayerTreeLayerState associated to the name
     */
    getTreeLayerByName(name) {
        for (const layer of this.findTreeLayers()) {
            if(layer.name === name) {
                return layer;
            }
        }
        throw RangeError('The layer name `'+ name +'` is unknown!');
    }

    /**
     * Remove a direct child item from this group's children list.
     * Internal helper used by `moveTreeItem` to reorder/move items (drag and drop in
     * the layer tree). Does not touch the underlying map item state tree.
     * @param {LayerTreeItemState} item - the child item to remove
     * @returns {number} the index the item was removed from, or -1 if not found
     */
    _removeItem(item) {
        const index = this._items.indexOf(item);
        if (index !== -1) {
            this._items.splice(index, 1);
        }
        return index;
    }

    /**
     * Insert an item as a direct child of this group at a given index.
     * Internal helper used by `moveTreeItem` to reorder/move items (drag and drop in
     * the layer tree). Does not touch the underlying map item state tree.
     * @param {LayerTreeItemState} item  - the child item to insert
     * @param {number}             index - the index to insert the item at (clamped to the valid range)
     */
    _insertItem(item, index) {
        const clampedIndex = Math.max(0, Math.min(index, this._items.length));
        this._items.splice(clampedIndex, 0, item);
    }
}

/**
 * Class representing a layer tree layer
 * @class
 * @augments LayerTreeItemState
 */
export class LayerTreeLayerState extends LayerTreeItemState {

    /**
     * Instantiate a layer tree layer
     * @param {MapLayerState}       mapLayerState      - the map layer state
     * @param {LayerTreeGroupState} [parentGroupState] - the parent layer tree group
     */
    constructor(mapLayerState, parentGroupState) {
        super(mapLayerState, parentGroupState);
        // set default icon
        this._icon = getDefaultLayerIcon(this.layerConfig);
    }

    /**
     * vector layer is loaded in a single layer ImageLayer or not
     * @type {boolean}
     */
    get singleWMSLayer(){
        return this._mapItemState.singleWMSLayer;
    }


    /**
     * Vector layer has selected features
     * The selected features is not empty
     * @type {boolean}
     */
    get hasSelectedFeatures() {
        return this._mapItemState.hasSelectedFeatures;
    }

    /**
     * Vector layer is filtered
     * The expression filter is not null
     * @type {boolean}
     */
    get isFiltered() {
        return this._mapItemState.isFiltered;
    }

    /**
     * The source icon of the layer
     * @type {string}
     */
    get icon() {
        if (this._mapItemState.symbology instanceof LayerIconSymbology) {
            return this.symbology.icon;
        }
        return this._icon;
    }

    /**
     * WMS selected layer style name
     * @type {string}
     */
    get wmsSelectedStyleName() {
        return this._mapItemState.wmsSelectedStyleName;
    }

    /**
     * Update WMS selected layer style name
     * based on wmsStyles list
     * @param {string} styleName - the WMS layer style name to select
     */
    set wmsSelectedStyleName(styleName) {
        this._mapItemState.wmsSelectedStyleName = styleName;
    }

    /**
     * WMS layer styles
     * @type {LayerStyleConfig[]}
     */
    get wmsStyles() {
        return this._mapItemState.wmsStyles;
    }

    /**
     * WMS layer attribution
     * @type {?AttributionConfig}
     */
    get wmsAttribution() {
        return this._mapItemState.wmsAttribution;
    }

    /**
     * Parameters for OGC WMS Request
     * @type {object}
     */
    get wmsParameters() {
        return this._mapItemState.wmsParameters;
    }

    /**
     * The layer load status
     * @see MapLayerLoadStatus
     * @type {string}
     */
    get loadStatus() {
        return this._mapItemState.loadStatus;
    }

    /**
     * Layer symbology
     * @type {?(LayerIconSymbology|LayerSymbolsSymbology|LayerGroupSymbology)}
     */
    get symbology() {
        return this._mapItemState.symbology;
    }

    /**
     * Update layer symbology
     * @param {(object | LayerIconSymbology | LayerSymbolsSymbology | LayerGroupSymbology)} node - The symbology node
     */
    set symbology(node) {
        this._mapItemState.symbology = node;
    }

    /**
     * Children symbology count
     * @type {number}
     */
    get symbologyChildrenCount() {
        if (this._mapItemState.symbology instanceof LayerSymbolsSymbology
            || this._mapItemState.symbology instanceof LayerGroupSymbology) {
            return this._mapItemState.symbology.childrenCount;
        }
        return 0;
    }

    /**
     * Children symbology
     * @type {(SymbolIconSymbology[]|Array.<BaseIconSymbology|BaseSymbolsSymbology>)}
     */
    get symbologyChildren() {
        if (this._mapItemState.symbology instanceof LayerSymbolsSymbology
            || this._mapItemState.symbology instanceof LayerGroupSymbology) {
            return this._mapItemState.symbology.children;
        }
        return [];
    }


    /**
     * Iterate through children nodes
     * @generator
     * @yields {SymbolIconSymbology|BaseIconSymbology|BaseSymbolsSymbology} The next child node
     */
    *getSymbologyChildren() {
        if (this._mapItemState.symbology instanceof LayerSymbolsSymbology
            || this._mapItemState.symbology instanceof LayerGroupSymbology) {
            for (const symbol of this._mapItemState.symbology.getChildren()) {
                yield symbol;
            }
        }
    }
}

/**
 * Class representing a layer tree group as tree root
 * @class
 * @augments LayerTreeGroupState
 */
export class TreeRootState extends LayerTreeGroupState {

    /**
     * Instantiate a root layer tree group
     * @param {MapGroupState} mapGroupState - the map layer group state
     */
    constructor(mapGroupState) {
        super(mapGroupState);

        mapGroupState.addListener(
            evt => {
                const extGroup = mapGroupState.children[0];
                if (evt.name != extGroup.name)
                    return;
                const extTreeGroup = new ExternalLayerTreeGroupState(extGroup);
                this._items.unshift(extTreeGroup);
                extTreeGroup.addListener(this.dispatch.bind(this), 'ol-layer.added');
                extTreeGroup.addListener(this.dispatch.bind(this), 'ol-layer.removed');
                extTreeGroup.addListener(this.dispatch.bind(this), 'ext-group.expanded.changed');

                extTreeGroup.addListener(this.dispatch.bind(this), 'ext-group.wmsTitle.changed');
                extTreeGroup.addListener(this.dispatch.bind(this), 'ext-group.visibility.changed');
                extTreeGroup.addListener(this.dispatch.bind(this), 'ol-layer.wmsTitle.changed');
                extTreeGroup.addListener(this.dispatch.bind(this), 'ol-layer.icon.changed');
                extTreeGroup.addListener(this.dispatch.bind(this), 'ol-layer.opacity.changed');
                extTreeGroup.addListener(this.dispatch.bind(this), 'ol-layer.visibility.changed');
            }, ['ext-group.added']
        );

        mapGroupState.addListener(
            evt => {
                const groups = this._items
                    .map((item, index) => {return {'name': item.name, 'type': item.type,'index':index}})
                    .filter((item) => item.type == 'ext-group' && item.name == evt.name);
                if (groups.length == 0) {
                    return;
                }
                const extTreeGroup = this._items.at(groups[0].index);
                this._items.splice(groups[0].index, 1);
                extTreeGroup.removeListener(this.dispatch.bind(this), 'ol-layer.added');
                extTreeGroup.removeListener(this.dispatch.bind(this), 'ol-layer.removed');
                extTreeGroup.removeListener(this.dispatch.bind(this), 'ext-group.expanded.changed');

                extTreeGroup.removeListener(this.dispatch.bind(this), 'ext-group.wmsTitle.changed');
                extTreeGroup.removeListener(this.dispatch.bind(this), 'ext-group.visibility.changed');
                extTreeGroup.removeListener(this.dispatch.bind(this), 'ol-layer.wmsTitle.changed');
                extTreeGroup.removeListener(this.dispatch.bind(this), 'ol-layer.icon.changed');
                extTreeGroup.removeListener(this.dispatch.bind(this), 'ol-layer.opacity.changed');
                extTreeGroup.removeListener(this.dispatch.bind(this), 'ol-layer.visibility.changed');
            }, ['ext-group.removed']
        );

        mapGroupState.addListener(this.dispatch.bind(this), 'ext-group.added');
        mapGroupState.addListener(this.dispatch.bind(this), 'ext-group.removed');
    }
}


/**
 * Move a layer or group item to a new position in the layer tree, possibly under a
 * different parent group (drag and drop reordering, QGIS layer panel style).
 *
 * The move is applied to the display tree (LayerTree*State, `<lizmap-treeview>`)
 * and to the mirrored map tree (Map*State). The read-only `layerOrder` is never
 * changed: call `map.updateLayersZIndex()` afterwards to update the map.
 *
 * Known limitation (see To_DO): a layer moved into another group still follows the
 * checkbox of its original group (the configuration tree of Layer.js is not
 * reparented).
 *
 * @param {LayerTreeItemState}  item        - the layer or group to move
 * @param {LayerTreeGroupState} targetGroup - the destination parent group (can be the
 *                                            tree root itself)
 * @param {number}              targetIndex - the index within `targetGroup.children`
 *                                            where the item should end up
 * @returns {boolean} true if the move was applied, false if it was rejected (invalid
 *                     target, or trying to move a group into itself or one of its own
 *                     descendants)
 */
export function moveTreeItem(item, targetGroup, targetIndex) {
    if (!(item instanceof LayerTreeItemState) || !(targetGroup instanceof LayerTreeGroupState)) {
        return false;
    }

    const sourceGroup = item.parentGroupState;
    if (!sourceGroup) {
        // Root item itself (or an item whose parent could not be determined): nothing to move from
        return false;
    }

    if (item === targetGroup) {
        return false;
    }

    // Prevent moving a group into itself or one of its own descendants
    if (item instanceof LayerTreeGroupState) {
        let ancestor = targetGroup;
        while (ancestor) {
            if (ancestor === item) {
                return false;
            }
            ancestor = ancestor.parentGroupState;
        }
    }

    const sameGroup = sourceGroup === targetGroup;

    const removedIndex = sourceGroup._removeItem(item);
    if (removedIndex === -1) {
        return false;
    }

    let insertIndex = targetIndex;
    if (sameGroup && removedIndex < insertIndex) {
        insertIndex -= 1;
    }
    targetGroup._insertItem(item, insertIndex);
    item._parentGroupState = targetGroup;

    // Mirror the same move in the underlying map rendering tree
    const mapItem = item.mapItemState;
    const sourceMapGroup = mapItem.parentMapGroup;
    const targetMapGroup = targetGroup.mapItemState;
    if (sourceMapGroup && targetMapGroup
        && typeof sourceMapGroup._removeItem === 'function'
        && typeof targetMapGroup._insertItem === 'function') {
        const mapRemovedIndex = sourceMapGroup._removeItem(mapItem);
        if (mapRemovedIndex !== -1) {
            let mapInsertIndex = insertIndex;
            if (sourceMapGroup === targetMapGroup && mapRemovedIndex < mapInsertIndex) {
                mapInsertIndex -= 1;
            }
            targetMapGroup._insertItem(mapItem, mapInsertIndex);
            mapItem._parentMapGroup = targetMapGroup;
        }
    }

    item.dispatch({
        type: item.type + '.moved',
        name: item.name
    });

    return true;
}
