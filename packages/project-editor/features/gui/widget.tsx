import React from "react";
import { observable, computed } from "mobx";
import { observer } from "mobx-react";
import { bind } from "bind-decorator";

import { _find, _range } from "eez-studio-shared/algorithm";
import { to16bitsColor } from "eez-studio-shared/color";
import { humanize } from "eez-studio-shared/string";
import { Rect } from "eez-studio-shared/geometry";
import { validators } from "eez-studio-shared/validation";

import { showGenericDialog } from "eez-studio-ui/generic-dialog";

import {
    EezObject,
    registerClass,
    EezArrayObject,
    ClassInfo,
    PropertyInfo,
    PropertyType,
    makeDerivedClassInfo,
    findClass,
    isArray,
    cloneObject,
    generalGroup,
    dataGroup,
    actionsGroup,
    geometryGroup,
    styleGroup,
    specificGroup,
    IPropertyGridGroupDefinition,
    areAllChildrenOfTheSameParent,
    isAncestor,
    getProperty
} from "project-editor/core/object";
import { loadObject, objectToJS } from "project-editor/core/serialization";
import { DocumentStore, NavigationStore, IContextMenuContext } from "project-editor/core/store";
import * as output from "project-editor/core/output";

import { Project } from "project-editor/project/project";

import {
    IResizeHandler,
    IDesignerContext
} from "project-editor/features/gui/page-editor/designer-interfaces";
import {
    WidgetContainerComponent,
    WidgetComponent
} from "project-editor/features/gui/page-editor/render";
import { EditorObject } from "project-editor/features/gui/page-editor/editor";

import { PropertyProps } from "project-editor/components/PropertyGrid";

import { ProjectStore } from "project-editor/core/store";

import * as data from "project-editor/features/data/data";

import { Page, lazyLoadPageWidgets } from "project-editor/features/gui/page";
import { Gui, findPage, findBitmap } from "project-editor/features/gui/gui";
import { Style, getStyleProperty } from "project-editor/features/gui/style";
import { findDataItem, dataContext } from "project-editor/features/data/data";
import { findAction } from "project-editor/features/action/action";
import {
    draw,
    drawText,
    styleGetBorderRadius,
    styleIsHorzAlignLeft,
    styleIsHorzAlignRight,
    styleIsVertAlignTop,
    styleIsVertAlignBottom,
    styleGetFont,
    textDrawingInBackground
} from "project-editor/features/gui/draw";
import * as lcd from "project-editor/features/gui/lcd";
import { Font } from "project-editor/features/gui/font";

import { BootstrapButton } from "project-editor/components/BootstrapButton";

const { MenuItem } = EEZStudio.electron.remote;

////////////////////////////////////////////////////////////////////////////////

function makeDataPropertyInfo(
    name: string,
    displayName?: string,
    propertyGridGroup?: IPropertyGridGroupDefinition
): PropertyInfo {
    return {
        name,
        displayName,
        type: PropertyType.ObjectReference,
        referencedObjectCollectionPath: ["data"],
        propertyGridGroup: propertyGridGroup || dataGroup
    };
}

function makeActionPropertyInfo(
    name: string,
    displayName?: string,
    propertyGridGroup?: IPropertyGridGroupDefinition
): PropertyInfo {
    return {
        name,
        displayName,
        type: PropertyType.ObjectReference,
        referencedObjectCollectionPath: ["actions"],
        propertyGridGroup: propertyGridGroup || actionsGroup
    };
}

function makeStylePropertyInfo(name: string, displayName?: string): PropertyInfo {
    return {
        name,
        displayName,
        type: PropertyType.Object,
        typeClass: Style,
        propertyGridGroup: styleGroup,
        propertyGridCollapsable: true,
        propertyGridCollapsableDefaultPropertyName: "inheritFrom",
        enumerable: false
    };
}

function htmlEncode(value: string) {
    const el = document.createElement("div");
    el.innerText = value;
    return el.innerHTML;
}

function migrateStyleProperty(jsObject: any, propertyName: string, propertyName2?: string) {
    if (jsObject[propertyName] === undefined) {
        jsObject[propertyName] = propertyName2
            ? jsObject[propertyName2]
            : {
                  inheritFrom: "default"
              };
    } else if (typeof jsObject[propertyName] === "string") {
        jsObject[propertyName] = {
            inheritFrom: jsObject[propertyName]
        };
    } else if (!jsObject[propertyName].inheritFrom) {
        jsObject[propertyName].inheritFrom = "default";
    }
}

////////////////////////////////////////////////////////////////////////////////

export type WidgetParent = Page | Widget;

interface IWidget {
    type: string;

    left: number;
    top: number;
    width: number;
    height: number;
}

export class Widget extends EezObject {
    @observable type: string;
    @observable style: Style;
    @observable activeStyle: Style;
    @observable data?: string;
    @observable action?: string;

    @observable left: number;
    @observable top: number;
    @observable width: number;
    @observable height: number;

    get label() {
        return this.type;
    }

    static classInfo: ClassInfo = {
        getClass: function(jsObject: any) {
            if (jsObject.type.startsWith("Local.")) {
                return findClass("LayoutViewWidget");
            }
            return findClass(jsObject.type + "Widget");
        },

        label: (widget: Widget) => {
            if (widget.data) {
                return `${humanize(widget.type)}: ${widget.data}`;
            }

            return humanize(widget.type);
        },

        properties: [
            {
                name: "type",
                type: PropertyType.Enum,
                hideInPropertyGrid: true
            },
            {
                name: "left",
                type: PropertyType.Number,
                propertyGridGroup: geometryGroup
            },
            {
                name: "top",
                type: PropertyType.Number,
                propertyGridGroup: geometryGroup
            },
            {
                name: "width",
                type: PropertyType.Number,
                propertyGridGroup: geometryGroup
            },
            {
                name: "height",
                type: PropertyType.Number,
                propertyGridGroup: geometryGroup
            },
            {
                name: "absolutePosition",
                type: PropertyType.String,
                propertyGridGroup: geometryGroup,
                computed: true
            },
            makeDataPropertyInfo("data"),
            makeActionPropertyInfo("action"),
            makeStylePropertyInfo("style", "Normal style"),
            makeStylePropertyInfo("activeStyle")
        ],

        beforeLoadHook: (object: EezObject, jsObject: any) => {
            if (jsObject.type.startsWith("Local.")) {
                jsObject.layout = jsObject.type.substring("Local.".length);
                jsObject.type = "LayoutView";
            }

            if (jsObject["x"] !== undefined) {
                jsObject["left"] = jsObject["x"];
                delete jsObject["x"];
            }

            if (jsObject["y"] !== undefined) {
                jsObject["top"] = jsObject["y"];
                delete jsObject["y"];
            }

            if (typeof jsObject.left === "string") {
                jsObject.left = parseInt(jsObject.left);
            }

            if (typeof jsObject.top === "string") {
                jsObject.top = parseInt(jsObject.top);
            }

            if (typeof jsObject.width === "string") {
                jsObject.width = parseInt(jsObject.width);
            }

            if (typeof jsObject.height === "string") {
                jsObject.height = parseInt(jsObject.height);
            }

            migrateStyleProperty(jsObject, "style");
            migrateStyleProperty(jsObject, "activeStyle", "style");
        },

        isPropertyMenuSupported: true
    };

    @computed
    get absolutePosition() {
        let x = this.left;
        let y = this.top;

        for (
            let parent = this.parent;
            parent && !(parent instanceof Page);
            parent = parent.parent
        ) {
            x += parent.left;
            y += parent.top;
        }

        return `${x}, ${y}`;
    }

    @computed
    get rect() {
        return {
            left: this.left,
            top: this.top,
            width: this.width,
            height: this.height
        };
    }

    @computed
    get isMoveable() {
        return true;
    }

    @computed
    get styleObject() {
        return this.style;
    }

    @computed
    get activeStyleObject() {
        return this.activeStyle;
    }

    // Return immediate parent, which can be of type Page or Widget
    // (i.e. ContainerWidget, ListWidget, GridWidget, SelectWidget)
    get parent(): WidgetParent {
        let parent = this._parent!;
        if (isArray(parent)) {
            parent = parent._parent!;
        }
        return parent as WidgetParent;
    }

    // If this widget is immediate child of SelectWidgetProperties parent return that parent.
    get selectParent(): SelectWidget | undefined {
        const parent = this.parent;
        if (parent instanceof SelectWidget) {
            return parent;
        }
        return undefined;
    }

    check() {
        let messages: output.Message[] = [];

        if (
            this.rect.left < 0 ||
            this.rect.top < 0 ||
            (this.parent &&
                (this.rect.left + this.rect.width > this.parent.rect.width ||
                    this.rect.top + this.rect.height > this.parent.rect.height))
        ) {
            messages.push(
                new output.Message(output.Type.ERROR, "Widget is outside of its parent", this)
            );
        }

        let selectParent = this.selectParent;
        if (selectParent) {
            if (this.width != selectParent.width) {
                messages.push(
                    new output.Message(
                        output.Type.WARNING,
                        "Child of select has different width",
                        this
                    )
                );
            }

            if (this.height != selectParent.height) {
                messages.push(
                    new output.Message(
                        output.Type.WARNING,
                        "Child of select has different height",
                        this
                    )
                );
            }
        }

        if (this.data) {
            if (!findDataItem(this.data)) {
                messages.push(output.propertyNotFoundMessage(this, "data"));
            }
        }

        if (this.action) {
            if (!findAction(this.action)) {
                messages.push(output.propertyNotFoundMessage(this, "action"));
            }
        }

        return messages;
    }

    extendContextMenu(
        context: IContextMenuContext,
        objects: EezObject[],
        menuItems: Electron.MenuItem[]
    ): void {
        var additionalMenuItems: Electron.MenuItem[] = [];

        if (objects.length === 1) {
            additionalMenuItems.push(
                new MenuItem({
                    label: "Put in Select",
                    click: () => {
                        const selectWidget = (objects[0] as Widget).putInSelect();
                        context.selectObject(selectWidget);
                    }
                })
            );
        }

        if (areAllChildrenOfTheSameParent(objects)) {
            additionalMenuItems.push(
                new MenuItem({
                    label: "Put in Container",
                    click: () => {
                        const containerWidget = Widget.putInContainer(objects as Widget[]);
                        context.selectObject(containerWidget);
                    }
                })
            );

            additionalMenuItems.push(
                new MenuItem({
                    label: "Create Layout",
                    click: async () => {
                        const layoutWidget = await Widget.createLayout(objects as Widget[]);
                        if (layoutWidget) {
                            context.selectObject(layoutWidget);
                        }
                    }
                })
            );
        }

        if (objects.length === 1) {
            const object = objects[0];

            if (object instanceof TextWidget) {
                additionalMenuItems.push(
                    new MenuItem({
                        label: "Convert to DisplayData",
                        click: () => {
                            const widget = object.convertToDisplayData();
                            if (widget) {
                                context.selectObject(widget);
                            }
                        }
                    })
                );
            }

            if (object instanceof LayoutViewWidget) {
                additionalMenuItems.push(
                    new MenuItem({
                        label: "Replace with Container",
                        click: () => {
                            const widget = object.replaceWithContainer();
                            if (widget) {
                                context.selectObject(widget);
                            }
                        }
                    })
                );
            }

            let parent = object._parent;
            if (parent && parent._parent instanceof SelectWidget) {
                additionalMenuItems.push(
                    new MenuItem({
                        label: "Replace Parent",
                        click: () => {
                            const widget = (object as Widget).replaceParent();
                            if (widget) {
                                context.selectObject(widget);
                            }
                        }
                    })
                );
            }
        }

        if (additionalMenuItems.length > 0) {
            additionalMenuItems.push(
                new MenuItem({
                    type: "separator"
                })
            );

            menuItems.unshift(...additionalMenuItems);
        }
    }

    putInSelect() {
        let thisWidgetJsObject = objectToJS(this);

        var selectWidgetJsObject = Object.assign({}, SelectWidget.classInfo.defaultValue);

        selectWidgetJsObject.left = this.rect.left;
        selectWidgetJsObject.top = this.rect.top;
        selectWidgetJsObject.width = this.rect.width;
        selectWidgetJsObject.height = this.rect.height;

        thisWidgetJsObject.left = 0;
        delete thisWidgetJsObject.left_;
        thisWidgetJsObject.top = 0;
        delete thisWidgetJsObject.top_;

        selectWidgetJsObject.widgets = [thisWidgetJsObject];

        return DocumentStore.replaceObject(
            this,
            loadObject(this._parent, selectWidgetJsObject, Widget)
        );
    }

    static createWidgets(fromWidgets: Widget[]) {
        let x1 = fromWidgets[0].rect.left;
        let y1 = fromWidgets[0].rect.top;
        let x2 = fromWidgets[0].rect.left + fromWidgets[0].rect.width;
        let y2 = fromWidgets[0].rect.top + fromWidgets[0].rect.height;

        for (let i = 1; i < fromWidgets.length; i++) {
            let widget = fromWidgets[i];
            x1 = Math.min(widget.rect.left, x1);
            y1 = Math.min(widget.rect.top, y1);
            x2 = Math.max(widget.rect.left + widget.rect.width, x2);
            y2 = Math.max(widget.rect.top + widget.rect.height, y2);
        }

        const widgets = [];

        for (let i = 0; i < fromWidgets.length; i++) {
            let widget = fromWidgets[i];
            let widgetJsObject = objectToJS(widget);

            widgetJsObject.left = fromWidgets[i].rect.left - x1;
            delete widgetJsObject.left_;
            widgetJsObject.top = fromWidgets[i].rect.top - y1;
            delete widgetJsObject.top_;

            widgets.push(widgetJsObject);
        }

        return {
            widgets,
            left: x1,
            top: y1,
            width: x2 - x1,
            height: y2 - y1
        };
    }

    static putInContainer(fromWidgets: Widget[]) {
        var containerWidgetJsObject: IContainerWidget = Object.assign(
            {},
            ContainerWidget.classInfo.defaultValue
        );

        const createWidgetsResult = Widget.createWidgets(fromWidgets);

        containerWidgetJsObject.widgets = createWidgetsResult.widgets;

        containerWidgetJsObject.left = createWidgetsResult.left;
        containerWidgetJsObject.top = createWidgetsResult.top;
        containerWidgetJsObject.width = createWidgetsResult.width;
        containerWidgetJsObject.height = createWidgetsResult.height;

        return DocumentStore.replaceObjects(
            fromWidgets,
            loadObject(fromWidgets[0]._parent, containerWidgetJsObject, Widget)
        );
    }

    static async createLayout(fromWidgets: Widget[]) {
        const layouts = (getProperty(ProjectStore.project, "gui") as Gui).pages;

        try {
            const result = await showGenericDialog({
                dialogDefinition: {
                    title: "Layout name",
                    fields: [
                        {
                            name: "name",
                            type: "string",
                            validators: [validators.required, validators.unique({}, layouts)]
                        }
                    ]
                },
                values: {
                    name: ""
                }
            });

            const layoutName = result.values.name;

            const createWidgetsResult = Widget.createWidgets(fromWidgets);

            DocumentStore.addObject(
                layouts,
                loadObject(
                    undefined,
                    {
                        name: layoutName,
                        left: 0,
                        top: 0,
                        width: createWidgetsResult.width,
                        height: createWidgetsResult.height,
                        widgets: createWidgetsResult.widgets
                    },
                    findClass("Page")!
                )
            );

            return DocumentStore.replaceObjects(
                fromWidgets,
                loadObject(
                    fromWidgets[0]._parent,
                    {
                        type: "LayoutView",
                        left: createWidgetsResult.left,
                        top: createWidgetsResult.top,
                        width: createWidgetsResult.width,
                        height: createWidgetsResult.height,
                        layout: layoutName
                    },
                    Widget
                )
            );
        } catch (error) {
            console.error(error);
            return undefined;
        }
    }

    replaceParent() {
        let parent = this._parent;
        if (parent) {
            let selectWidget = parent._parent;
            if (selectWidget instanceof SelectWidget) {
                return DocumentStore.replaceObject(
                    selectWidget,
                    cloneObject(selectWidget._parent, this)
                );
            }
        }
        return undefined;
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        return undefined;
    }

    render(rect: Rect, designerContext?: IDesignerContext): React.ReactNode {
        return undefined;
    }

    getResizeHandlers(): IResizeHandler[] | undefined | false {
        return [
            {
                x: 0,
                y: 0,
                type: "nw-resize"
            },
            {
                x: 50,
                y: 0,
                type: "n-resize"
            },
            {
                x: 100,
                y: 0,
                type: "ne-resize"
            },
            {
                x: 0,
                y: 50,
                type: "w-resize"
            },
            {
                x: 100,
                y: 50,
                type: "e-resize"
            },
            {
                x: 0,
                y: 100,
                type: "sw-resize"
            },
            {
                x: 50,
                y: 100,
                type: "s-resize"
            },
            {
                x: 100,
                y: 100,
                type: "se-resize"
            }
        ];
    }

    getColumnWidth(columnIndex: number) {
        return NaN;
    }

    resizeColumn(columnIndex: number, savedColumnWidth: number, offset: number) {}

    getRowHeight(rowIndex: number) {
        return NaN;
    }

    resizeRow(rowIndex: number, savedRowWidth: number, offset: number) {}

    open() {}

    styleHook(style: React.CSSProperties, designerContext: IDesignerContext | undefined) {
        const backgroundColor = getStyleProperty(this.style, "backgroundColor");
        style.backgroundColor = to16bitsColor(backgroundColor);
    }
}

registerClass(Widget);

////////////////////////////////////////////////////////////////////////////////

interface IContainerWidget extends IWidget {
    widgets: IWidget[];
}

export class ContainerWidget extends Widget {
    @observable
    name: string;

    @observable
    widgets: EezArrayObject<Widget>;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        label: (widget: ContainerWidget) => {
            if (widget.name) {
                return `${humanize(widget.type)}: ${widget.name}`;
            }
            return humanize(widget.type);
        },

        properties: [
            {
                name: "widgets",
                type: PropertyType.Array,
                typeClass: Widget,
                hideInPropertyGrid: true
            },
            {
                name: "name",
                type: PropertyType.String,
                propertyGridGroup: generalGroup
            }
        ],

        defaultValue: {
            type: "Container",
            widgets: [],
            left: 0,
            top: 0,
            width: 64,
            height: 32
        } as IContainerWidget,

        icon: "_images/widgets/Container.png"
    });

    render(rect: Rect) {
        return <WidgetContainerComponent containerWidget={this} widgets={this.widgets._array} />;
    }
}

registerClass(ContainerWidget);

////////////////////////////////////////////////////////////////////////////////

export class ListWidget extends Widget {
    @observable itemWidget?: Widget;
    @observable listType?: string;
    @observable gap?: number;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "itemWidget",
                type: PropertyType.Object,
                typeClass: Widget,
                hideInPropertyGrid: true,
                isOptional: true
            },
            {
                name: "listType",
                type: PropertyType.Enum,
                propertyGridGroup: specificGroup,
                enumItems: [
                    {
                        id: "vertical"
                    },
                    {
                        id: "horizontal"
                    }
                ]
            },
            {
                name: "gap",
                type: PropertyType.Number,
                propertyGridGroup: specificGroup
            }
        ],

        defaultValue: {
            type: "List",
            itemWidget: {
                type: "Container",
                widgets: [],
                left: 0,
                top: 0,
                width: 64,
                height: 32
            },
            left: 0,
            top: 0,
            width: 64,
            height: 32,
            listType: "vertical",
            gap: 0
        },

        icon: "_images/widgets/List.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        if (!this.itemWidget) {
            messages.push(
                new output.Message(output.Type.ERROR, "List item widget is missing", this)
            );
        }

        return super.check().concat(messages);
    }

    render(rect: Rect) {
        const itemWidget = this.itemWidget;
        if (!itemWidget) {
            return null;
        }

        const itemRect = itemWidget.rect;

        const listItemsCount = this.data ? dataContext.count(this.data) : 0;

        return _range(listItemsCount).map(i => {
            let xListItem = 0;
            let yListItem = 0;

            const gap = this.gap || 0;

            if (this.listType === "horizontal") {
                xListItem += i * (itemRect.width + gap);
            } else {
                yListItem += i * (itemRect.height + gap);
            }

            return (
                <WidgetComponent
                    key={i}
                    widget={itemWidget}
                    rect={{
                        left: xListItem,
                        top: yListItem,
                        width: itemRect.width,
                        height: itemRect.height
                    }}
                />
            );
        });
    }
}

registerClass(ListWidget);

////////////////////////////////////////////////////////////////////////////////

export class GridWidget extends Widget {
    @observable itemWidget?: Widget;
    @observable gridFlow?: string;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "itemWidget",
                type: PropertyType.Object,
                typeClass: Widget,
                hideInPropertyGrid: true,
                isOptional: true
            },
            {
                name: "gridFlow",
                type: PropertyType.Enum,
                propertyGridGroup: specificGroup,
                enumItems: [
                    {
                        id: "row"
                    },
                    {
                        id: "column"
                    }
                ]
            }
        ],

        defaultValue: {
            type: "Grid",
            itemWidget: {
                type: "Container",
                widgets: [],
                left: 0,
                top: 0,
                width: 32,
                height: 32,
                gridFlow: "row"
            },
            left: 0,
            top: 0,
            width: 64,
            height: 64
        },

        icon: "_images/widgets/Grid.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        if (!this.itemWidget) {
            messages.push(
                new output.Message(output.Type.ERROR, "Grid item widget is missing", this)
            );
        }

        return super.check().concat(messages);
    }

    render(rect: Rect) {
        const itemWidget = this.itemWidget;
        if (!itemWidget) {
            return null;
        }

        const gridRect = rect;
        const itemRect = itemWidget.rect;

        const gridItemsCount = this.data ? dataContext.count(this.data) : 0;

        return _range(gridItemsCount).map(i => {
            const rows = Math.floor(gridRect.width / itemRect.width);
            const cols = Math.floor(gridRect.height / itemRect.height);

            let row;
            let col;
            if (this.gridFlow === "column") {
                row = Math.floor(i / cols);
                col = i % cols;
                if (row >= rows) {
                    return undefined;
                }
            } else {
                row = i % rows;
                col = Math.floor(i / rows);
                if (col >= cols) {
                    return undefined;
                }
            }

            let xListItem = row * itemRect.width;
            let yListItem = col * itemRect.height;

            return (
                <WidgetComponent
                    key={i}
                    widget={itemWidget}
                    rect={{
                        left: xListItem,
                        top: yListItem,
                        width: itemRect.width,
                        height: itemRect.height
                    }}
                />
            );
        });
    }
}

registerClass(GridWidget);

////////////////////////////////////////////////////////////////////////////////

export class SelectWidget extends Widget {
    @observable
    widgets: EezArrayObject<Widget>;

    _lastSelectedIndexInSelectWidget: number | undefined;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "widgets",
                type: PropertyType.Array,
                typeClass: Widget,
                hideInPropertyGrid: true,
                childLabel: (childObject: EezObject, childLabel: string) => {
                    let label;

                    if (childObject._parent) {
                        let selectWidgetProperties = childObject._parent!._parent as SelectWidget;

                        label = selectWidgetProperties.getChildLabel(childObject as Widget);
                    }

                    return `${label || "???"} ➔ ${childLabel}`;
                },

                interceptAddObject: (widgets: EezArrayObject<Widget>, object: Widget) => {
                    object.left = 0;
                    object.top = 0;
                    object.width = (widgets._parent as SelectWidget).width;
                    object.height = (widgets._parent as SelectWidget).height;
                    return object;
                }
            }
        ],

        defaultValue: {
            type: "Select",
            widgets: [],
            left: 0,
            top: 0,
            width: 64,
            height: 32
        },

        icon: "_images/widgets/Select.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        } else {
            let dataItem = findDataItem(this.data);
            if (dataItem) {
                let enumItems: string[] = [];
                if (dataItem.type == "enum") {
                    try {
                        enumItems = JSON.parse(dataItem.enumItems || "[]");
                    } catch (err) {
                        enumItems = [];
                    }
                } else if (dataItem.type == "boolean") {
                    enumItems = ["0", "1"];
                }
                if (enumItems.length > this.widgets._array.length) {
                    messages.push(
                        new output.Message(
                            output.Type.ERROR,
                            "Some select children are missing",
                            this
                        )
                    );
                } else if (enumItems.length < this.widgets._array.length) {
                    messages.push(
                        new output.Message(
                            output.Type.ERROR,
                            "Too many select children defined",
                            this
                        )
                    );
                }
            }
        }

        return super.check().concat(messages);
    }

    getChildLabel(childObject: Widget) {
        if (this.widgets) {
            let index = this.widgets._array.indexOf(childObject);
            if (index != -1) {
                if (this.data) {
                    let dataItem = findDataItem(this.data);
                    if (dataItem) {
                        if (dataItem.type == "enum") {
                            let enumItems: string[];
                            try {
                                enumItems = JSON.parse(dataItem.enumItems || "[]");
                            } catch (err) {
                                enumItems = [];
                                console.error("Invalid enum items", dataItem, err);
                            }

                            if (index < enumItems.length) {
                                let enumItemLabel = htmlEncode(enumItems[index]);
                                return enumItemLabel;
                            }
                        } else if (dataItem.type == "boolean") {
                            if (index == 0) {
                                return "0";
                            } else if (index == 1) {
                                return "1";
                            }
                        }
                    }
                }
            }
        }

        return undefined;
    }

    getSelectedWidget() {
        if (this.data) {
            let index: number = dataContext.getEnumValue(this.data);
            if (index >= 0 && index < this.widgets._array.length) {
                return this.widgets._array[index];
            }
        }
        return undefined;
    }

    getSelectedIndex(designerContext?: IDesignerContext) {
        if (designerContext) {
            const selectedObjects = designerContext.viewState.selectedObjects;

            for (let i = 0; i < this.widgets._array.length; ++i) {
                if (
                    selectedObjects.find(selectedObject =>
                        isAncestor((selectedObject as EditorObject).object, this.widgets._array[i])
                    )
                ) {
                    this._lastSelectedIndexInSelectWidget = i;
                    return i;
                }
            }

            if (
                this._lastSelectedIndexInSelectWidget !== undefined &&
                this._lastSelectedIndexInSelectWidget < this.widgets._array.length
            ) {
                return this._lastSelectedIndexInSelectWidget;
            }

            const selectedWidget = this.getSelectedWidget();
            if (selectedWidget) {
                return this.widgets._array.indexOf(selectedWidget);
            }

            if (this.widgets._array.length > 0) {
                this._lastSelectedIndexInSelectWidget = 0;
                return this._lastSelectedIndexInSelectWidget;
            }
        } else {
            if (
                this._lastSelectedIndexInSelectWidget !== undefined &&
                this._lastSelectedIndexInSelectWidget < this.widgets._array.length
            ) {
                return this._lastSelectedIndexInSelectWidget;
            }

            const selectedWidget = this.getSelectedWidget();
            if (selectedWidget) {
                return this.widgets._array.indexOf(selectedWidget);
            }
        }

        return -1;
    }

    render(rect: Rect, designerContext?: IDesignerContext) {
        const index = this.getSelectedIndex(designerContext);
        if (index === -1) {
            return null;
        }

        const selectedWidget = this.widgets._array[index];

        return <WidgetContainerComponent containerWidget={this} widgets={[selectedWidget]} />;
    }
}

registerClass(SelectWidget);

////////////////////////////////////////////////////////////////////////////////

@observer
class LayoutViewPropertyGridUI extends React.Component<PropertyProps> {
    @bind
    showLayout() {
        (this.props.objects[0] as LayoutViewWidget).open();
    }

    render() {
        if (this.props.objects.length > 1) {
            return null;
        }
        return (
            <BootstrapButton color="primary" size="small" onClick={this.showLayout}>
                Show Layout
            </BootstrapButton>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export class LayoutViewWidget extends Widget {
    @observable layout: string;
    @observable context?: string;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "layout",
                type: PropertyType.ObjectReference,
                propertyGridGroup: specificGroup,
                referencedObjectCollectionPath: ["gui", "pages"]
            },
            makeDataPropertyInfo("context"),
            {
                name: "customUI",
                type: PropertyType.Any,
                propertyGridGroup: specificGroup,
                computed: true,
                propertyGridComponent: LayoutViewPropertyGridUI
            }
        ],

        label: (widget: LayoutViewWidget) => {
            if (widget.layout) {
                return `${widget.type}: ${widget.layout}`;
            }

            return humanize(widget.type);
        },

        defaultValue: {
            type: "LayoutView",
            left: 0,
            top: 0,
            width: 64,
            height: 32
        },

        icon: "_images/widgets/LayoutView.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data && !this.layout) {
            messages.push(
                new output.Message(output.Type.ERROR, "Either layout or data must be set", this)
            );
        } else {
            if (this.data && this.layout) {
                messages.push(
                    new output.Message(
                        output.Type.ERROR,
                        "Both layout and data set, only layout is used",
                        this
                    )
                );
            }

            if (this.layout) {
                let layout = findPage(this.layout);
                if (!layout) {
                    messages.push(output.propertyNotFoundMessage(this, "layout"));
                }
            }
        }

        if (this.context) {
            if (!findDataItem(this.context)) {
                messages.push(output.propertyNotFoundMessage(this, "context"));
            }
        }

        return super.check().concat(messages);
    }

    get layoutPage() {
        let layout;

        if (this.data) {
            const layoutName = dataContext.get(this.data);
            if (layoutName) {
                layout = findPage(layoutName);
            }
        }

        if (!layout) {
            layout = findPage(this.layout);
        }

        if (!layout) {
            return null;
        }

        if (isAncestor(this, layout)) {
            // prevent cyclic referencing
            return null;
        }

        return layout;
    }

    render(rect: Rect): React.ReactNode {
        if (!this.layoutPage) {
            return null;
        }

        lazyLoadPageWidgets.prioritizePage(this.layoutPage);

        return <WidgetComponent widget={this.layoutPage} />;
    }

    open() {
        if (this.layoutPage) {
            NavigationStore.showObject(this.layoutPage);
        }
    }

    replaceWithContainer() {
        if (this.layoutPage) {
            var containerWidgetJsObject = Object.assign({}, ContainerWidget.classInfo.defaultValue);

            containerWidgetJsObject.widgets = this.layoutPage.widgets._array.map(widget =>
                objectToJS(widget)
            );

            containerWidgetJsObject.left = this.left;
            containerWidgetJsObject.top = this.top;
            containerWidgetJsObject.width = this.width;
            containerWidgetJsObject.height = this.height;

            return DocumentStore.replaceObject(
                this,
                loadObject(this._parent, containerWidgetJsObject, Widget)
            );
        }
        return undefined;
    }
}

registerClass(LayoutViewWidget);

////////////////////////////////////////////////////////////////////////////////

enum DisplayOption {
    All = 0,
    Integer = 1,
    FractionAndUnit = 2,
    Fraction = 3,
    Unit = 4,
    IntegerAndFraction = 5
}

export class DisplayDataWidget extends Widget {
    @observable focusStyle: Style;
    @observable displayOption: DisplayOption;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            makeStylePropertyInfo("focusStyle"),
            {
                name: "displayOption",
                type: PropertyType.Enum,
                enumItems: [
                    {
                        id: DisplayOption.All,
                        label: "All"
                    },
                    {
                        id: DisplayOption.Integer,
                        label: "Integer"
                    },
                    {
                        id: DisplayOption.FractionAndUnit,
                        label: "Fraction and unit"
                    },
                    {
                        id: DisplayOption.Fraction,
                        label: "Fraction"
                    },
                    {
                        id: DisplayOption.Unit,
                        label: "Unit"
                    },
                    {
                        id: DisplayOption.IntegerAndFraction,
                        label: "Integer and fraction"
                    }
                ],
                propertyGridGroup: specificGroup
            }
        ],

        beforeLoadHook: (object: EezObject, jsObject: any) => {
            migrateStyleProperty(jsObject, "focusStyle");
        },

        defaultValue: {
            type: "DisplayData",
            data: "data",
            left: 0,
            top: 0,
            width: 64,
            height: 32,
            displayOption: 0
        },

        icon: "_images/widgets/Data.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        if (this.displayOption === undefined) {
            if ((ProjectStore.project as Project).settings.general.projectVersion !== "v1") {
                messages.push(output.propertyNotSetMessage(this, "displayOption"));
            }
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let text = (this.data && (data.get(this.data) as string)) || "";

        function findStartOfFraction() {
            let i;
            for (i = 0; text[i] && (text[i] == "-" || (text[i] >= "0" && text[i] <= "9")); i++) {}
            return i;
        }

        function findStartOfUnit(i: number) {
            for (
                i = 0;
                text[i] && (text[i] == "-" || (text[i] >= "0" && text[i] <= "9") || text[i] == ".");
                i++
            ) {}
            return i;
        }

        if (this.displayOption === DisplayOption.Integer) {
            let i = findStartOfFraction();
            text = text.substr(0, i);
        } else if (this.displayOption === DisplayOption.FractionAndUnit) {
            let i = findStartOfFraction();
            text = text.substr(i);
        } else if (this.displayOption === DisplayOption.Fraction) {
            let i = findStartOfFraction();
            let k = findStartOfUnit(i);
            if (i < k) {
                text = text.substring(i, k);
            } else {
                text = ".00";
            }
        } else if (this.displayOption === DisplayOption.Unit) {
            let i = findStartOfUnit(0);
            text = text.substr(i);
        } else if (this.displayOption === DisplayOption.IntegerAndFraction) {
            let i = findStartOfUnit(0);
            text = text.substr(0, i);
        }

        return drawText(text, rect.width, rect.height, this.style, false);
    }
}

registerClass(DisplayDataWidget);

////////////////////////////////////////////////////////////////////////////////

export class TextWidget extends Widget {
    @observable
    text?: string;
    @observable
    ignoreLuminocity: boolean;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        label: (widget: TextWidget) => {
            if (widget.text) {
                return `${humanize(widget.type)}: ${widget.text}`;
            }

            if (widget.data) {
                return `${humanize(widget.type)}: ${widget.data}`;
            }

            return humanize(widget.type);
        },

        properties: [
            {
                name: "text",
                type: PropertyType.String,
                propertyGridGroup: specificGroup
            },
            {
                name: "ignoreLuminocity",
                type: PropertyType.Boolean,
                defaultValue: false,
                propertyGridGroup: specificGroup
            }
        ],

        defaultValue: {
            type: "Text",
            text: "Text",
            left: 0,
            top: 0,
            width: 64,
            height: 32
        },

        icon: "_images/widgets/Text.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.text && !this.data) {
            messages.push(output.propertyNotSetMessage(this, "text"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let text = (this.data ? (data.get(this.data) as string) : this.text) || "";
        return drawText(text, rect.width, rect.height, this.style, false);
    }

    convertToDisplayData() {
        var displayDataWidgetJsObject = Object.assign(
            {},
            DisplayDataWidget.classInfo.defaultValue,
            objectToJS(this),
            {
                type: DisplayDataWidget.classInfo.defaultValue.type
            }
        );

        return DocumentStore.replaceObject(
            this,
            loadObject(this._parent, displayDataWidgetJsObject, Widget)
        );
    }
}

registerClass(TextWidget);

////////////////////////////////////////////////////////////////////////////////

enum MultilineTextRenderStep {
    MEASURE,
    RENDER
}

class MultilineTextRender {
    constructor(
        private ctx: CanvasRenderingContext2D,
        private text: string,
        private x1: number,
        private y1: number,
        private x2: number,
        private y2: number,
        private style: Style,
        private inverse: boolean,
        private firstLineIndent: number,
        private hangingIndent: number
    ) {}

    private font: Font;

    private spaceWidth: number;

    private lineHeight: number;
    private textHeight: number;

    private line: string;
    private lineIndent: number;
    private lineWidth: number;

    flushLine(y: number, step: MultilineTextRenderStep) {
        if (this.line != "" && this.lineWidth > 0) {
            if (step == MultilineTextRenderStep.RENDER) {
                let x;

                if (styleIsHorzAlignLeft(this.style)) {
                    x = this.x1;
                } else if (styleIsHorzAlignRight(this.style)) {
                    x = this.x2 + 1 - this.lineWidth;
                } else {
                    x = this.x1 + Math.floor((this.x2 - this.x1 + 1 - this.lineWidth) / 2);
                }

                if (this.inverse) {
                    lcd.setBackColor(getStyleProperty(this.style, "color"));
                    lcd.setColor(getStyleProperty(this.style, "backgroundColor"));
                } else {
                    lcd.setBackColor(getStyleProperty(this.style, "backgroundColor"));
                    lcd.setColor(getStyleProperty(this.style, "color"));
                }

                textDrawingInBackground.drawStr(
                    this.ctx,
                    this.line,
                    x + this.lineIndent,
                    y,
                    x + this.lineWidth - 1,
                    y + this.font.height - 1,
                    this.font
                );
            } else {
                this.textHeight = Math.max(this.textHeight, y + this.lineHeight - this.y1);
            }

            this.line = "";
            this.lineWidth = this.lineIndent = this.hangingIndent;
        }
    }

    executeStep(step: MultilineTextRenderStep) {
        this.textHeight = 0;

        let y = this.y1;

        this.line = "";
        this.lineWidth = this.lineIndent = this.firstLineIndent;

        let i = 0;

        while (true) {
            let word = "";
            while (i < this.text.length && this.text[i] != " " && this.text[i] != "\n") {
                word += this.text[i++];
            }

            let width = lcd.measureStr(word, this.font, 0);

            while (
                this.lineWidth + (this.line != "" ? this.spaceWidth : 0) + width >
                this.x2 - this.x1 + 1
            ) {
                this.flushLine(y, step);

                y += this.lineHeight;
                if (y + this.lineHeight - 1 > this.y2) {
                    break;
                }
            }

            if (y + this.lineHeight - 1 > this.y2) {
                break;
            }

            if (this.line != "") {
                this.line += " ";
                this.lineWidth += this.spaceWidth;
            }
            this.line += word;
            this.lineWidth += width;

            while (this.text[i] == " ") {
                i++;
            }

            if (i == this.text.length || this.text[i] == "\n") {
                this.flushLine(y, step);

                y += this.lineHeight;

                if (i == this.text.length) {
                    break;
                }

                i++;

                let extraHeightBetweenParagraphs = Math.floor(0.2 * this.lineHeight);

                y += extraHeightBetweenParagraphs;

                if (y + this.lineHeight - 1 > this.y2) {
                    break;
                }
            }
        }

        this.flushLine(y, step);

        return this.textHeight + this.font.height - this.lineHeight;
    }

    render() {
        const borderSize = this.style.borderSizeRect;
        let borderRadius = styleGetBorderRadius(this.style) || 0;
        if (
            borderSize.top > 0 ||
            borderSize.right > 0 ||
            borderSize.bottom > 0 ||
            borderSize.left > 0
        ) {
            lcd.setColor(getStyleProperty(this.style, "borderColor"));
            lcd.fillRect(this.ctx, this.x1, this.y1, this.x2, this.y2, borderRadius);
            this.x1 += borderSize.left;
            this.y1 += borderSize.top;
            this.x2 -= borderSize.right;
            this.y2 -= borderSize.bottom;
            borderRadius = Math.max(
                borderRadius -
                    Math.max(borderSize.top, borderSize.right, borderSize.bottom, borderSize.left),
                0
            );
        }

        let backgroundColor = this.inverse
            ? getStyleProperty(this.style, "color")
            : getStyleProperty(this.style, "backgroundColor");
        lcd.setColor(backgroundColor);
        lcd.fillRect(this.ctx, this.x1, this.y1, this.x2, this.y2, borderRadius);

        const font = styleGetFont(this.style);
        if (!font) {
            return;
        }

        let lineHeight = Math.floor(0.9 * font.height);
        if (lineHeight <= 0) {
            return;
        }

        try {
            this.text = JSON.parse('"' + this.text + '"');
        } catch (e) {
            console.error(e, this.text);
            return;
        }

        this.font = font;
        this.lineHeight = lineHeight;

        this.x1 += this.style.paddingRect.left;
        this.x2 -= this.style.paddingRect.right;
        this.y1 += this.style.paddingRect.top;
        this.y2 -= this.style.paddingRect.bottom;

        const spaceGlyph = font.glyphs._array.find(glyph => glyph.encoding == 32);
        this.spaceWidth = (spaceGlyph && spaceGlyph.dx) || 0;

        const textHeight = this.executeStep(MultilineTextRenderStep.MEASURE);

        if (styleIsVertAlignTop(this.style)) {
        } else if (styleIsVertAlignBottom(this.style)) {
            this.y1 = this.y2 + 1 - textHeight;
        } else {
            this.y1 += Math.floor((this.y2 - this.y1 + 1 - textHeight) / 2);
        }
        this.y2 = this.y1 + textHeight - 1;

        this.executeStep(MultilineTextRenderStep.RENDER);
    }
}

export const indentationGroup: IPropertyGridGroupDefinition = {
    id: "indentation",
    title: "Indentation",
    position: 5
};

export class MultilineTextWidget extends Widget {
    @observable text?: string;
    @observable firstLineIndent: number;
    @observable hangingIndent: number;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        label: (widget: TextWidget) => {
            if (widget.text) {
                return `${humanize(widget.type)}: ${widget.text}`;
            }

            if (widget.data) {
                return `${humanize(widget.type)}: ${widget.data}`;
            }

            return humanize(widget.type);
        },

        properties: [
            {
                name: "text",
                type: PropertyType.String,
                propertyGridGroup: specificGroup
            },
            {
                name: "firstLineIndent",
                displayName: "First line",
                type: PropertyType.Number,
                propertyGridGroup: indentationGroup
            },
            {
                name: "hangingIndent",
                displayName: "Hanging",
                type: PropertyType.Number,
                propertyGridGroup: indentationGroup
            }
        ],

        defaultValue: {
            type: "MultilineText",
            text: "Multiline text",
            left: 0,
            top: 0,
            width: 64,
            height: 32,
            firstLineIndent: 0,
            hangingIndent: 0
        },

        icon: "_images/widgets/MultilineText.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.text && !this.data) {
            messages.push(output.propertyNotSetMessage(this, "text"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let text = (this.data ? (data.get(this.data) as string) : this.text) || "";

        const w = rect.width;
        const h = rect.height;
        const style = this.style;
        const inverse = false;

        return draw(w, h, (ctx: CanvasRenderingContext2D) => {
            let x1 = 0;
            let y1 = 0;
            let x2 = w - 1;
            let y2 = h - 1;

            var multilineTextRender = new MultilineTextRender(
                ctx,
                text,
                x1,
                y1,
                x2,
                y2,
                style,
                inverse,
                this.firstLineIndent || 0,
                this.hangingIndent || 0
            );
            multilineTextRender.render();
        });
    }
}

registerClass(MultilineTextWidget);

////////////////////////////////////////////////////////////////////////////////

export class RectangleWidget extends Widget {
    @observable
    ignoreLuminocity: boolean;
    @observable
    invertColors: boolean;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "invertColors",
                type: PropertyType.Boolean,
                propertyGridGroup: specificGroup,
                defaultValue: false
            },
            {
                name: "ignoreLuminocity",
                type: PropertyType.Boolean,
                propertyGridGroup: specificGroup,
                defaultValue: false
            }
        ],

        defaultValue: {
            type: "Rectangle",
            left: 0,
            top: 0,
            width: 64,
            height: 32
        },

        icon: "_images/widgets/Rectangle.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (this.data) {
            messages.push(output.propertySetButNotUsedMessage(this, "data"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        const w = rect.width;
        const h = rect.height;
        const style = this.style;
        const inverse = this.invertColors;

        if (w > 0 && h > 0) {
            return draw(w, h, (ctx: CanvasRenderingContext2D) => {
                let x1 = 0;
                let y1 = 0;
                let x2 = w - 1;
                let y2 = h - 1;

                const borderSize = style.borderSizeRect;
                let borderRadius = styleGetBorderRadius(style) || 0;
                if (
                    borderSize.top > 0 ||
                    borderSize.right > 0 ||
                    borderSize.bottom > 0 ||
                    borderSize.left > 0
                ) {
                    lcd.setColor(getStyleProperty(style, "borderColor"));
                    lcd.fillRect(ctx, x1, y1, x2, y2, borderRadius);
                    x1 += borderSize.left;
                    y1 += borderSize.top;
                    x2 -= borderSize.right;
                    y2 -= borderSize.bottom;
                    borderRadius = Math.max(
                        borderRadius -
                            Math.max(
                                borderSize.top,
                                borderSize.right,
                                borderSize.bottom,
                                borderSize.left
                            ),
                        0
                    );
                }

                lcd.setColor(
                    inverse
                        ? getStyleProperty(style, "backgroundColor")
                        : getStyleProperty(style, "color")
                );
                lcd.fillRect(ctx, x1, y1, x2, y2, borderRadius);
            });
        }
        return undefined;
    }
}

registerClass(RectangleWidget);

////////////////////////////////////////////////////////////////////////////////

@observer
class BitmapWidgetPropertyGridUI extends React.Component<PropertyProps> {
    get bitmapWidget() {
        return this.props.objects[0] as BitmapWidget;
    }

    @bind
    resizeToFitBitmap() {
        DocumentStore.updateObject(this.props.objects[0], {
            width: this.bitmapWidget.bitmapObject!.imageElement!.width,
            height: this.bitmapWidget.bitmapObject!.imageElement!.height
        });
    }

    render() {
        if (this.props.objects.length > 1) {
            return null;
        }

        const bitmapObject = this.bitmapWidget.bitmapObject;
        if (!bitmapObject) {
            return null;
        }

        const imageElement = bitmapObject.imageElement;
        if (!imageElement) {
            return null;
        }

        return (
            <BootstrapButton color="primary" size="small" onClick={this.resizeToFitBitmap}>
                Resize to Fit Bitmap
            </BootstrapButton>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

export class BitmapWidget extends Widget {
    @observable
    bitmap?: string;

    get label() {
        return this.bitmap ? `${this.type}: ${this.bitmap}` : this.type;
    }

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "bitmap",
                type: PropertyType.ObjectReference,
                referencedObjectCollectionPath: ["gui", "bitmaps"],
                propertyGridGroup: specificGroup
            },
            {
                name: "customUI",
                type: PropertyType.Any,
                propertyGridGroup: specificGroup,
                computed: true,
                propertyGridComponent: BitmapWidgetPropertyGridUI
            }
        ],

        defaultValue: { type: "Bitmap", left: 0, top: 0, width: 64, height: 32 },

        icon: "_images/widgets/Bitmap.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data && !this.bitmap) {
            messages.push(
                new output.Message(output.Type.ERROR, "Either bitmap or data must be set", this)
            );
        } else {
            if (this.data && this.bitmap) {
                messages.push(
                    new output.Message(
                        output.Type.ERROR,
                        "Both bitmap and data set, only bitmap is used",
                        this
                    )
                );
            }

            if (this.bitmap) {
                let bitmap = findBitmap(this.bitmap);
                if (!bitmap) {
                    messages.push(output.propertyNotFoundMessage(this, "bitmap"));
                }
            }
        }

        return super.check().concat(messages);
    }

    @computed
    get bitmapObject() {
        return this.bitmap
            ? findBitmap(this.bitmap)
            : this.data
            ? findBitmap(data.get(this.data) as string)
            : undefined;
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        const w = rect.width;
        const h = rect.height;
        const style = this.style;

        const bitmap = this.bitmapObject;

        const inverse = false;

        if (bitmap) {
            const imageElement = bitmap.imageElement;
            if (!imageElement) {
                return undefined;
            }

            return draw(w, h, (ctx: CanvasRenderingContext2D) => {
                let x1 = 0;
                let y1 = 0;
                let x2 = w - 1;
                let y2 = h - 1;

                if (bitmap.bpp !== 32) {
                    let backgroundColor = inverse
                        ? getStyleProperty(style, "color")
                        : getStyleProperty(style, "backgroundColor");
                    lcd.setColor(backgroundColor);
                    lcd.fillRect(ctx, x1, y1, x2, y2, 0);
                }

                let width = imageElement.width;
                let height = imageElement.height;

                let x_offset: number;
                if (styleIsHorzAlignLeft(style)) {
                    x_offset = x1 + style.paddingRect.left;
                } else if (styleIsHorzAlignRight(style)) {
                    x_offset = x2 - style.paddingRect.right - width;
                } else {
                    x_offset = Math.floor(x1 + (x2 - x1 - width) / 2);
                }

                let y_offset: number;
                if (styleIsVertAlignTop(style)) {
                    y_offset = y1 + style.paddingRect.top;
                } else if (styleIsVertAlignBottom(style)) {
                    y_offset = y2 - style.paddingRect.bottom - height;
                } else {
                    y_offset = Math.floor(y1 + (y2 - y1 - height) / 2);
                }

                if (inverse) {
                    lcd.setBackColor(getStyleProperty(style, "color"));
                    lcd.setColor(getStyleProperty(style, "backgroundColor"));
                } else {
                    lcd.setBackColor(getStyleProperty(style, "backgroundColor"));
                    lcd.setColor(getStyleProperty(style, "color"));
                }

                lcd.drawBitmap(ctx, imageElement, x_offset, y_offset, width, height);
            });
        }

        return undefined;
    }
}

registerClass(BitmapWidget);

////////////////////////////////////////////////////////////////////////////////

export class ButtonWidget extends Widget {
    @observable
    text?: string;
    @observable
    enabled?: string;
    @observable
    disabledStyle: Style;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "text",
                type: PropertyType.String,
                propertyGridGroup: specificGroup
            },
            makeDataPropertyInfo("enabled"),
            makeStylePropertyInfo("disabledStyle")
        ],

        beforeLoadHook: (object: EezObject, jsObject: any) => {
            migrateStyleProperty(jsObject, "disabledStyle");
        },

        defaultValue: { type: "Button", left: 0, top: 0, width: 32, height: 32 },

        icon: "_images/widgets/Button.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.text && !this.data) {
            messages.push(output.propertyNotSetMessage(this, "text"));
        }

        if (this.enabled) {
            if (!data.findDataItem(this.enabled)) {
                messages.push(output.propertyNotFoundMessage(this, "enabled"));
            }
        } else {
            messages.push(output.propertyNotSetMessage(this, "enabled"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let text = this.data && data.get(this.data);
        if (!text) {
            text = this.text;
        }
        let style = this.enabled && data.getBool(this.enabled) ? this.style : this.disabledStyle;
        return drawText(text, rect.width, rect.height, style, false);
    }
}

registerClass(ButtonWidget);

////////////////////////////////////////////////////////////////////////////////

export class ToggleButtonWidget extends Widget {
    @observable
    text1?: string;
    @observable
    text2?: string;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "text1",
                type: PropertyType.String,
                propertyGridGroup: specificGroup
            },
            {
                name: "text2",
                type: PropertyType.String,
                propertyGridGroup: specificGroup
            }
        ],

        defaultValue: {
            type: "ToggleButton",
            left: 0,
            top: 0,
            width: 32,
            height: 32
        },

        icon: "_images/widgets/ToggleButton.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        if (!this.text1) {
            messages.push(output.propertyNotSetMessage(this, "text1"));
        }

        if (!this.text2) {
            messages.push(output.propertyNotSetMessage(this, "text2"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        return drawText(this.text1 || "", rect.width, rect.height, this.style, false);
    }
}

registerClass(ToggleButtonWidget);

////////////////////////////////////////////////////////////////////////////////

export class ButtonGroupWidget extends Widget {
    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        defaultValue: {
            type: "ButtonGroup",
            left: 0,
            top: 0,
            width: 64,
            height: 32
        },

        icon: "_images/widgets/ButtonGroup.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let buttonLabels = (this.data && data.getValueList(this.data)) || [];
        let selectedButton = (this.data && data.get(this.data)) || 0;
        let style = this.style;

        return draw(rect.width, rect.height, (ctx: CanvasRenderingContext2D) => {
            let x = 0;
            let y = 0;
            let w = rect.width;
            let h = rect.height;

            if (w > h) {
                // horizontal orientation
                let buttonWidth = Math.floor(w / buttonLabels.length);
                x += Math.floor((w - buttonWidth * buttonLabels.length) / 2);
                let buttonHeight = h;
                for (let i = 0; i < buttonLabels.length; i++) {
                    ctx.drawImage(
                        drawText(
                            buttonLabels[i],
                            buttonWidth,
                            buttonHeight,
                            style,
                            i == selectedButton
                        ),
                        x,
                        y
                    );
                    x += buttonWidth;
                }
            } else {
                // vertical orientation
                let buttonWidth = w;
                let buttonHeight = Math.floor(h / buttonLabels.length);

                y += Math.floor((h - buttonHeight * buttonLabels.length) / 2);

                let labelHeight = Math.min(buttonWidth, buttonHeight);
                let yOffset = Math.floor((buttonHeight - labelHeight) / 2);

                for (let i = 0; i < buttonLabels.length; i++) {
                    ctx.drawImage(
                        drawText(
                            buttonLabels[i],
                            buttonWidth,
                            labelHeight,
                            style,
                            i == selectedButton
                        ),
                        x,
                        y + yOffset
                    );
                    y += buttonHeight;
                }
            }
        });
    }
}

registerClass(ButtonGroupWidget);

////////////////////////////////////////////////////////////////////////////////

export class ScaleWidget extends Widget {
    @observable
    needlePosition: string;
    @observable
    needleWidth: number;
    @observable
    needleHeight: number;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "needlePosition",
                type: PropertyType.Enum,
                propertyGridGroup: specificGroup,
                enumItems: [
                    {
                        id: "left"
                    },
                    {
                        id: "right"
                    },
                    {
                        id: "top"
                    },
                    {
                        id: "bottom"
                    }
                ]
            },
            {
                name: "needleWidth",
                propertyGridGroup: specificGroup,
                type: PropertyType.Number
            },
            {
                name: "needleHeight",
                propertyGridGroup: specificGroup,
                type: PropertyType.Number
            }
        ],

        defaultValue: {
            type: "Scale",
            left: 0,
            top: 0,
            width: 64,
            height: 32,
            needlePostion: "right",
            needleWidth: 19,
            needleHeight: 11
        },

        icon: "_images/widgets/Scale.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        return super.check().concat(messages);
    }

    drawScale(
        ctx: CanvasRenderingContext2D,
        rect: Rect,
        y_from: number,
        y_to: number,
        y_min: number,
        y_max: number,
        y_value: number,
        f: number,
        d: number
    ) {
        let vertical = this.needlePosition == "left" || this.needlePosition == "right";
        let flip = this.needlePosition == "left" || this.needlePosition == "top";

        let needleSize: number;

        let x1: number, l1: number, x2: number, l2: number;
        if (vertical) {
            needleSize = this.needleHeight || 0;

            if (flip) {
                x1 = this.needleWidth + 2;
                l1 = rect.width - (this.needleWidth + 2);
                x2 = 0;
                l2 = this.needleWidth || 0;
            } else {
                x1 = 0;
                l1 = rect.width - (this.needleWidth + 2);
                x2 = rect.width - this.needleWidth;
                l2 = this.needleWidth || 0;
            }
        } else {
            needleSize = this.needleWidth || 0;

            if (flip) {
                x1 = this.needleHeight + 2;
                l1 = rect.height - (this.needleHeight + 2);
                x2 = 0;
                l2 = this.needleHeight || 0;
            } else {
                x1 = 0;
                l1 = rect.height - this.needleHeight - 2;
                x2 = rect.height - this.needleHeight;
                l2 = this.needleHeight || 0;
            }
        }

        let s = (10 * f) / d;

        let y_offset: number;
        if (vertical) {
            y_offset = Math.floor(rect.height - 1 - (rect.height - (y_max - y_min)) / 2);
        } else {
            y_offset = Math.floor((rect.width - (y_max - y_min)) / 2);
        }

        let style = this.style;

        for (let y_i = y_from; y_i <= y_to; y_i++) {
            let y: number;

            if (vertical) {
                y = y_offset - y_i;
            } else {
                y = y_offset + y_i;
            }

            // draw ticks
            if (y_i >= y_min && y_i <= y_max) {
                if (y_i % s == 0) {
                    lcd.setColor(getStyleProperty(style, "borderColor"));
                    if (vertical) {
                        lcd.drawHLine(ctx, x1, y, l1);
                    } else {
                        lcd.drawVLine(ctx, y, x1, l1);
                    }
                } else if (y_i % (s / 2) == 0) {
                    lcd.setColor(getStyleProperty(style, "borderColor"));
                    if (vertical) {
                        if (flip) {
                            lcd.drawHLine(ctx, x1 + l1 / 2, y, l1 / 2);
                        } else {
                            lcd.drawHLine(ctx, x1, y, l1 / 2);
                        }
                    } else {
                        if (flip) {
                            lcd.drawVLine(ctx, y, x1 + l1 / 2, l1 / 2);
                        } else {
                            lcd.drawVLine(ctx, y, x1, l1 / 2);
                        }
                    }
                } else if (y_i % (s / 10) == 0) {
                    lcd.setColor(getStyleProperty(style, "borderColor"));
                    if (vertical) {
                        if (flip) {
                            lcd.drawHLine(ctx, x1 + l1 - l1 / 4, y, l1 / 4);
                        } else {
                            lcd.drawHLine(ctx, x1, y, l1 / 4);
                        }
                    } else {
                        if (flip) {
                            lcd.drawVLine(ctx, y, x1 + l1 - l1 / 4, l1 / 4);
                        } else {
                            lcd.drawVLine(ctx, y, x1, l1 / 4);
                        }
                    }
                } else {
                    lcd.setColor(getStyleProperty(style, "backgroundColor"));
                    if (vertical) {
                        lcd.drawHLine(ctx, x1, y, l1);
                    } else {
                        lcd.drawVLine(ctx, y, x1, l1);
                    }
                }
            }

            let d = Math.abs(y_i - y_value);
            if (d <= Math.floor(needleSize / 2)) {
                // draw thumb
                lcd.setColor(getStyleProperty(style, "color"));
                if (vertical) {
                    if (flip) {
                        lcd.drawHLine(ctx, x2, y, l2 - d);
                    } else {
                        lcd.drawHLine(ctx, x2 + d, y, l2 - d);
                    }
                } else {
                    if (flip) {
                        lcd.drawVLine(ctx, y, x2, l2 - d);
                    } else {
                        lcd.drawVLine(ctx, y, x2 + d, l2 - d);
                    }
                }

                if (y_i != y_value) {
                    lcd.setColor(getStyleProperty(style, "backgroundColor"));
                    if (vertical) {
                        if (flip) {
                            lcd.drawHLine(ctx, x2 + l2 - d, y, d);
                        } else {
                            lcd.drawHLine(ctx, x2, y, d);
                        }
                    } else {
                        if (flip) {
                            lcd.drawVLine(ctx, y, x2 + l2 - d, d);
                        } else {
                            lcd.drawVLine(ctx, y, x2, d);
                        }
                    }
                }
            } else {
                // erase
                lcd.setColor(getStyleProperty(style, "backgroundColor"));
                if (vertical) {
                    lcd.drawHLine(ctx, x2, y, l2);
                } else {
                    lcd.drawVLine(ctx, y, x2, l2);
                }
            }
        }
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let style = this.style;

        return draw(rect.width, rect.height, (ctx: CanvasRenderingContext2D) => {
            let value = 0;
            let min = (this.data && data.getMin(this.data)) || 0;
            let max = (this.data && data.getMax(this.data)) || 0;

            lcd.setColor(getStyleProperty(style, "backgroundColor"));
            lcd.fillRect(ctx, 0, 0, rect.width - 1, rect.height - 1);

            let vertical = this.needlePosition == "left" || this.needlePosition == "right";

            let needleSize: number;
            let f: number;
            if (vertical) {
                needleSize = this.needleHeight || 0;
                f = Math.floor((rect.height - needleSize) / max);
            } else {
                needleSize = this.needleWidth || 0;
                f = Math.floor((rect.width - needleSize) / max);
            }

            let d: number;
            if (max > 10) {
                d = 1;
            } else {
                f = 10 * (f / 10);
                d = 10;
            }

            let y_min = Math.round(min * f);
            let y_max = Math.round(max * f);
            let y_value = Math.round(value * f);

            let y_from_min = y_min - Math.floor(needleSize / 2);
            let y_from_max = y_max + Math.floor(needleSize / 2);

            this.drawScale(ctx, rect, y_from_min, y_from_max, y_min, y_max, y_value, f, d);
        });
    }
}

registerClass(ScaleWidget);

////////////////////////////////////////////////////////////////////////////////

export class BarGraphWidget extends Widget {
    @observable orientation?: string;
    @observable textStyle: Style;
    @observable line1Data?: string;
    @observable line1Style: Style;
    @observable line2Data?: string;
    @observable line2Style: Style;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            {
                name: "orientation",
                type: PropertyType.Enum,
                propertyGridGroup: specificGroup,
                enumItems: [
                    {
                        id: "left-right"
                    },
                    {
                        id: "right-left"
                    },
                    {
                        id: "top-bottom"
                    },
                    {
                        id: "bottom-top"
                    }
                ]
            },
            makeStylePropertyInfo("textStyle"),
            makeStylePropertyInfo("line1Style"),
            makeStylePropertyInfo("line2Style"),
            makeDataPropertyInfo("line1Data"),
            makeDataPropertyInfo("line2Data")
        ],

        beforeLoadHook: (object: EezObject, jsObject: any) => {
            migrateStyleProperty(jsObject, "textStyle");
            migrateStyleProperty(jsObject, "line1Style");
            migrateStyleProperty(jsObject, "line2Style");
        },

        defaultValue: {
            type: "BarGraph",
            left: 0,
            top: 0,
            width: 64,
            height: 32,
            orientation: "left-right"
        },

        icon: "_images/widgets/BarGraph.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        if (this.line1Data) {
            if (!findDataItem(this.line1Data)) {
                messages.push(output.propertyNotFoundMessage(this, "line1Data"));
            }
        } else {
            messages.push(output.propertyNotSetMessage(this, "line1Data"));
        }

        if (this.line2Data) {
            if (!findDataItem(this.line2Data)) {
                messages.push(output.propertyNotFoundMessage(this, "line2Data"));
            }
        } else {
            messages.push(output.propertyNotSetMessage(this, "line2Data"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let barGraphWidget = this;
        let style = barGraphWidget.style;

        return draw(rect.width, rect.height, (ctx: CanvasRenderingContext2D) => {
            let min = (barGraphWidget.data && data.getMin(barGraphWidget.data)) || 0;
            let max = (barGraphWidget.data && data.getMax(barGraphWidget.data)) || 0;
            let valueText = (barGraphWidget.data && data.get(barGraphWidget.data)) || "0";
            let value = parseFloat(valueText);
            if (isNaN(value)) {
                value = 0;
            }
            let horizontal =
                barGraphWidget.orientation == "left-right" ||
                barGraphWidget.orientation == "right-left";

            let d = horizontal ? rect.width : rect.height;

            function calcPos(value: number) {
                let pos = Math.round((value * d) / (max - min));
                if (pos < 0) {
                    pos = 0;
                }
                if (pos > d) {
                    pos = d;
                }
                return pos;
            }

            let pos = calcPos(value);

            if (barGraphWidget.orientation == "left-right") {
                lcd.setColor(getStyleProperty(style, "color"));
                lcd.fillRect(ctx, 0, 0, pos - 1, rect.height - 1);
                lcd.setColor(getStyleProperty(style, "backgroundColor"));
                lcd.fillRect(ctx, pos, 0, rect.width - 1, rect.height - 1);
            } else if (barGraphWidget.orientation == "right-left") {
                lcd.setColor(getStyleProperty(style, "backgroundColor"));
                lcd.fillRect(ctx, 0, 0, rect.width - pos - 1, rect.height - 1);
                lcd.setColor(getStyleProperty(style, "color"));
                lcd.fillRect(ctx, rect.width - pos, 0, rect.width - 1, rect.height - 1);
            } else if (barGraphWidget.orientation == "top-bottom") {
                lcd.setColor(getStyleProperty(style, "color"));
                lcd.fillRect(ctx, 0, 0, rect.width - 1, pos - 1);
                lcd.setColor(getStyleProperty(style, "backgroundColor"));
                lcd.fillRect(ctx, 0, pos, rect.width - 1, rect.height - 1);
            } else {
                lcd.setColor(getStyleProperty(style, "backgroundColor"));
                lcd.fillRect(ctx, 0, 0, rect.width - 1, rect.height - pos - 1);
                lcd.setColor(getStyleProperty(style, "color"));
                lcd.fillRect(ctx, 0, rect.height - pos, rect.width - 1, rect.height - 1);
            }

            if (horizontal) {
                let textStyle = barGraphWidget.textStyle;
                const font = styleGetFont(textStyle);
                if (font) {
                    let w = lcd.measureStr(valueText, font, rect.width);
                    w += style.paddingRect.left;

                    if (w > 0 && rect.height > 0) {
                        let backgroundColor: string;
                        let x: number;

                        if (pos + w <= rect.width) {
                            backgroundColor = getStyleProperty(style, "backgroundColor");
                            x = pos;
                        } else {
                            backgroundColor = getStyleProperty(style, "color");
                            x = pos - w - style.paddingRect.right;
                        }

                        ctx.drawImage(
                            drawText(valueText, w, rect.height, textStyle, false, backgroundColor),
                            x,
                            0
                        );
                    }
                }
            }

            function drawLine(lineData: string | undefined, lineStyle: Style) {
                let value = (lineData && parseFloat(data.get(lineData))) || 0;
                if (isNaN(value)) {
                    value = 0;
                }
                let pos = calcPos(value);
                if (pos == d) {
                    pos = d - 1;
                }
                lcd.setColor(getStyleProperty(lineStyle, "color"));
                if (barGraphWidget.orientation == "left-right") {
                    lcd.drawVLine(ctx, pos, 0, rect.height - 1);
                } else if (barGraphWidget.orientation == "right-left") {
                    lcd.drawVLine(ctx, rect.width - pos, 0, rect.height - 1);
                } else if (barGraphWidget.orientation == "top-bottom") {
                    lcd.drawHLine(ctx, 0, pos, rect.width - 1);
                } else {
                    lcd.drawHLine(ctx, 0, rect.height - pos, rect.width - 1);
                }
            }

            drawLine(barGraphWidget.line1Data, barGraphWidget.line1Style);
            drawLine(barGraphWidget.line2Data, barGraphWidget.line2Style);
        });
    }
}

registerClass(BarGraphWidget);

////////////////////////////////////////////////////////////////////////////////

export class YTGraphWidget extends Widget {
    @observable y1Style: Style;
    @observable y2Data?: string;
    @observable y2Style: Style;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            makeStylePropertyInfo("y1Style"),
            makeStylePropertyInfo("y2Style"),
            makeDataPropertyInfo("y2Data")
        ],

        beforeLoadHook: (object: EezObject, jsObject: any) => {
            migrateStyleProperty(jsObject, "y1Style");
            migrateStyleProperty(jsObject, "y2Style");
        },

        defaultValue: {
            type: "YTGraph",
            left: 0,
            top: 0,
            width: 64,
            height: 32
        },

        icon: "_images/widgets/YTGraph.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        if (this.y2Data) {
            if (!findDataItem(this.y2Data)) {
                messages.push(output.propertyNotFoundMessage(this, "y2Data"));
            }
        } else {
            messages.push(output.propertyNotSetMessage(this, "y2Data"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let ytGraphWidget = this;
        let style = ytGraphWidget.style;

        return draw(rect.width, rect.height, (ctx: CanvasRenderingContext2D) => {
            let x1 = 0;
            let y1 = 0;
            let x2 = rect.width - 1;
            let y2 = rect.height - 1;

            const borderSize = style.borderSizeRect;
            let borderRadius = styleGetBorderRadius(style) || 0;
            if (
                borderSize.top > 0 ||
                borderSize.right > 0 ||
                borderSize.bottom > 0 ||
                borderSize.left > 0
            ) {
                lcd.setColor(getStyleProperty(style, "borderColor"));
                lcd.fillRect(ctx, x1, y1, x2, y2, borderRadius);
                x1 += borderSize.left;
                y1 += borderSize.top;
                x2 -= borderSize.right;
                y2 -= borderSize.bottom;
                borderRadius = Math.max(
                    borderRadius -
                        Math.max(
                            borderSize.top,
                            borderSize.right,
                            borderSize.bottom,
                            borderSize.left
                        ),
                    0
                );
            }

            lcd.setColor(getStyleProperty(style, "backgroundColor"));
            lcd.fillRect(ctx, x1, y1, x2, y2, borderRadius);
        });
    }
}

registerClass(YTGraphWidget);

////////////////////////////////////////////////////////////////////////////////

export class UpDownWidget extends Widget {
    @observable buttonsStyle: Style;
    @observable downButtonText?: string;
    @observable upButtonText?: string;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            makeStylePropertyInfo("buttonsStyle"),
            {
                name: "downButtonText",
                type: PropertyType.String,
                propertyGridGroup: specificGroup
            },
            {
                name: "upButtonText",
                type: PropertyType.String,
                propertyGridGroup: specificGroup
            }
        ],

        beforeLoadHook: (object: EezObject, jsObject: any) => {
            migrateStyleProperty(jsObject, "buttonsStyle");
        },

        defaultValue: {
            type: "UpDown",
            left: 0,
            top: 0,
            width: 64,
            height: 32,
            upButtonText: ">",
            downButtonText: "<"
        },

        icon: "_images/widgets/UpDown.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        if (!this.downButtonText) {
            messages.push(output.propertyNotSetMessage(this, "downButtonText"));
        }

        if (!this.upButtonText) {
            messages.push(output.propertyNotSetMessage(this, "upButtonText"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let upDownWidget = this;
        let style = upDownWidget.style;
        let buttonsStyle = upDownWidget.buttonsStyle;

        return draw(rect.width, rect.height, (ctx: CanvasRenderingContext2D) => {
            const buttonsFont = styleGetFont(buttonsStyle);
            if (!buttonsFont) {
                return;
            }

            let downButtonCanvas = drawText(
                upDownWidget.downButtonText || "<",
                buttonsFont.height,
                rect.height,
                buttonsStyle,
                false
            );
            ctx.drawImage(downButtonCanvas, 0, 0);

            let text = upDownWidget.data ? (data.get(upDownWidget.data) as string) : "";
            let textCanvas = drawText(
                text,
                rect.width - 2 * buttonsFont.height,
                rect.height,
                style,
                false
            );
            ctx.drawImage(textCanvas, buttonsFont.height, 0);

            let upButonCanvas = drawText(
                upDownWidget.upButtonText || ">",
                buttonsFont.height,
                rect.height,
                buttonsStyle,
                false
            );
            ctx.drawImage(upButonCanvas, rect.width - buttonsFont.height, 0);
        });
    }
}

registerClass(UpDownWidget);

////////////////////////////////////////////////////////////////////////////////

export class ListGraphWidget extends Widget {
    @observable dwellData?: string;
    @observable y1Data?: string;
    @observable y1Style: Style;
    @observable y2Data?: string;
    @observable y2Style: Style;
    @observable cursorData?: string;
    @observable cursorStyle: Style;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        properties: [
            makeDataPropertyInfo("dwellData"),
            makeDataPropertyInfo("y1Data"),
            makeStylePropertyInfo("y1Style"),
            makeStylePropertyInfo("y2Style"),
            makeStylePropertyInfo("cursorStyle"),
            makeDataPropertyInfo("y2Data"),
            makeDataPropertyInfo("cursorData")
        ],

        beforeLoadHook: (object: EezObject, jsObject: any) => {
            migrateStyleProperty(jsObject, "y1Style");
            migrateStyleProperty(jsObject, "y2Style");
            migrateStyleProperty(jsObject, "cursorStyle");
        },

        defaultValue: {
            type: "ListGraph",
            left: 0,
            top: 0,
            width: 64,
            height: 32
        },

        icon: "_images/widgets/ListGraph.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        if (this.dwellData) {
            if (!findDataItem(this.dwellData)) {
                messages.push(output.propertyNotFoundMessage(this, "dwellData"));
            }
        } else {
            messages.push(output.propertyNotSetMessage(this, "dwellData"));
        }

        if (this.y1Data) {
            if (!data.findDataItem(this.y1Data)) {
                messages.push(output.propertyNotFoundMessage(this, "y1Data"));
            }
        } else {
            messages.push(output.propertyNotSetMessage(this, "y1Data"));
        }

        if (this.y2Data) {
            if (!findDataItem(this.y2Data)) {
                messages.push(output.propertyNotFoundMessage(this, "y2Data"));
            }
        } else {
            messages.push(output.propertyNotSetMessage(this, "y2Data"));
        }

        if (this.cursorData) {
            if (!data.findDataItem(this.cursorData)) {
                messages.push(output.propertyNotFoundMessage(this, "cursorData"));
            }
        } else {
            messages.push(output.propertyNotSetMessage(this, "cursorData"));
        }

        return super.check().concat(messages);
    }

    draw(rect: Rect): HTMLCanvasElement | undefined {
        let listGraphWidget = this;
        let style = listGraphWidget.style;

        return draw(rect.width, rect.height, (ctx: CanvasRenderingContext2D) => {
            let x1 = 0;
            let y1 = 0;
            let x2 = rect.width - 1;
            let y2 = rect.height - 1;

            const borderSize = style.borderSizeRect;
            let borderRadius = styleGetBorderRadius(style) || 0;
            if (
                borderSize.top > 0 ||
                borderSize.right > 0 ||
                borderSize.bottom > 0 ||
                borderSize.left > 0
            ) {
                lcd.setColor(getStyleProperty(style, "borderColor"));
                lcd.fillRect(ctx, x1, y1, x2, y2, borderRadius);
                x1 += borderSize.left;
                y1 += borderSize.top;
                x2 -= borderSize.right;
                y2 -= borderSize.bottom;
                borderRadius = Math.max(
                    borderRadius -
                        Math.max(
                            borderSize.top,
                            borderSize.right,
                            borderSize.bottom,
                            borderSize.left
                        ),
                    0
                );
            }

            lcd.setColor(getStyleProperty(style, "backgroundColor"));
            lcd.fillRect(ctx, x1, y1, x2, y2, borderRadius);
        });
    }
}

registerClass(ListGraphWidget);

////////////////////////////////////////////////////////////////////////////////

export class AppViewWidget extends Widget {
    @observable
    page: string;

    static classInfo = makeDerivedClassInfo(Widget.classInfo, {
        defaultValue: { type: "AppView", left: 0, top: 0, width: 64, height: 32 },

        icon: "_images/widgets/AppView.png"
    });

    check() {
        let messages: output.Message[] = [];

        if (!this.data) {
            messages.push(output.propertyNotSetMessage(this, "data"));
        }

        return super.check().concat(messages);
    }

    render(rect: Rect) {
        if (!this.data) {
            return null;
        }

        const pageName = dataContext.get(this.data);
        if (!pageName) {
            return null;
        }

        const page = findPage(pageName);
        if (!page) {
            return null;
        }

        return page.render(rect);
    }
}

registerClass(AppViewWidget);
