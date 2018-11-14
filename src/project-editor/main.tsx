/// <reference path="./globals.d.ts"/>
import { configure } from "mobx";
import * as React from "react";
import * as ReactDOM from "react-dom";

import { theme } from "eez-studio-shared/ui/theme";
import { ThemeProvider } from "eez-studio-shared/ui/styled-components";

import { ProjectStore } from "project-editor/core/store";
import { loadExtensions } from "project-editor/core/extensions";
import { init as storeInit } from "project-editor/core/store";
import { ProjectEditor } from "project-editor/project/ProjectEditor";

configure({ enforceActions: "observed" });

window.requestAnimationFrame(async () => {
    try {
        await loadExtensions();
        storeInit();
        ReactDOM.render(
            <ThemeProvider theme={theme}>
                <ProjectEditor />
            </ThemeProvider>,
            document.getElementById("content")
        );
    } catch (err) {
        console.error(err);
    }
});

EEZStudio.electron.ipcRenderer.on("beforeClose", () => {
    ProjectStore.closeWindow();
});

EEZStudio.electron.ipcRenderer.on("reload", () => {
    ProjectStore.saveUIState();
    window.location.reload();
});

//require("eez-studio-shared/module-stat");
