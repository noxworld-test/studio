import { observable, action } from "mobx";

import { IEezObject } from "project-editor/core/object";
import { DocumentStore, UndoManager } from "project-editor/core/store";

////////////////////////////////////////////////////////////////////////////////

interface IDropObject {}

////////////////////////////////////////////////////////////////////////////////

export class DragAndDropManagerClass {
    @observable dragObject: IEezObject | undefined;
    @observable dropObject: IDropObject | undefined;
    dragItemDeleted: boolean;
    dropEffect: string | undefined;
    blankDragImage: HTMLImageElement;
    unsetDropObjectAndPositionTimeout: any;

    constructor() {
        this.blankDragImage = new Image();
        this.blankDragImage.src =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAYdEVYdFNvZnR3YXJlAHBhaW50Lm5ldCA0LjAuOWwzfk4AAAANSURBVBhXY/j//z8DAAj8Av6IXwbgAAAAAElFTkSuQmCC";
    }

    @action
    start(event: any, dragObject: IEezObject) {
        this.dragObject = dragObject;
        this.dragItemDeleted = false;

        UndoManager.setCombineCommands(true);
    }

    @action
    setDropObject(object: IDropObject) {
        this.dropObject = object;
    }

    @action.bound
    unsetDropObject() {
        this.dropObject = undefined;
    }

    drag(event: any) {}

    setDropEffect(event: any) {
        this.dropEffect =
            event.dataTransfer.effectAllowed == "copyMove" && !event.ctrlKey ? "move" : "copy";
        event.dataTransfer.dropEffect = this.dropEffect;
    }

    deleteDragItem() {
        if (this.dropObject && this.dropEffect == "move") {
            if (this.dragObject) {
                DocumentStore.deleteObject(this.dragObject);
            }
            this.dropEffect = undefined;
            this.dragItemDeleted = true;
        }
    }

    @action
    end(event: any) {
        if (!this.dragItemDeleted) {
            this.dropEffect = event.dataTransfer.dropEffect;
            this.deleteDragItem();
        }
        this.dragObject = undefined;
        this.unsetDropObject();
        UndoManager.setCombineCommands(false);
    }
}

export let DragAndDropManager: DragAndDropManagerClass;

try {
    DragAndDropManager = new DragAndDropManagerClass();
} catch (err) {
    console.error(err);
}
