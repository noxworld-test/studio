import React from "react";
import { computed } from "mobx";
import { observer } from "mobx-react";
import { bind } from "bind-decorator";

import styled from "eez-studio-ui/styled-components";
import { ButtonAction } from "eez-studio-ui/action";
import { AppRootComponent } from "eez-studio-ui/app";
import { AlertDanger } from "eez-studio-ui/alert";
import { Loader } from "eez-studio-ui/loader";
import { Toolbar } from "eez-studio-ui/toolbar";
import { PanelHeader } from "eez-studio-ui/header-with-body";

import { InstrumentAppStore } from "instrument/window/app-store";
import { getConnection } from "instrument/window/connection";
import { IInstrumentWindowNavigationItem } from "instrument/window/navigation-store";

////////////////////////////////////////////////////////////////////////////////

const ConnectionBar: typeof PanelHeader = styled(PanelHeader)`
    display: flex;
    flex-direction: row;
    align-items: center;

    > div:nth-child(1) {
        /* Instrument image */
        > img {
            object-fit: contain;
            height: 46px;
            margin-right: 10px;
        }
    }

    > div:nth-child(2) {
        display: flex;
        flex-direction: column;

        /* Instrument name */
        > div:nth-child(1) {
            font-weight: bold;
        }

        > div:nth-child(2) {
            display: flex;
            flex-direction: row;
            align-items: center;

            /* connection info */
            > div:nth-child(1) {
                font-size: 90%;
                margin-right: 10px;
            }

            button {
                padding: 1px 4px;
            }
        }
    }

    > div:nth-child(3) {
        margin-left: 50px;
        flex-grow: 1;
    }
` as any;

////////////////////////////////////////////////////////////////////////////////

@observer
export class AppBar extends React.Component<
    {
        appStore: InstrumentAppStore;
        selectedItem: IInstrumentWindowNavigationItem;
    },
    {}
> {
    get instrument() {
        return this.props.appStore.instrument!;
    }

    get connection() {
        return getConnection(this.props.appStore);
    }

    @bind
    handleConnectClick() {
        this.connection.openConnectDialog();
    }

    @bind
    handleDisconnectClick() {
        this.instrument.connection.disconnect();
    }

    render() {
        let connectionStatus;
        if (this.instrument.connection.isIdle) {
            connectionStatus = (
                <div>
                    <button className="btn btn-success btn-sm" onClick={this.handleConnectClick}>
                        Connect
                    </button>
                </div>
            );
        } else if (this.instrument.connection.isConnected) {
            connectionStatus = (
                <div>
                    <div>{this.connection.interfaceInfo}</div>
                    <button className="btn btn-danger btn-sm" onClick={this.handleDisconnectClick}>
                        Disconnect
                    </button>
                </div>
            );
        } else {
            connectionStatus = (
                <div>
                    <div style={{ display: "inline-block" }}>
                        <Loader size={25} />
                    </div>
                    <button className="btn btn-danger btn-sm" onClick={this.handleDisconnectClick}>
                        Abort
                    </button>
                </div>
            );
        }

        let sendFile;
        if (this.instrument.sendFileToInstrumentHandler && this.instrument.connection.isConnected) {
            if (this.props.appStore.history.sendFileStatus) {
                if (
                    this.props.appStore.navigationStore.mainNavigationSelectedItem !=
                    this.props.appStore.navigationStore.terminalNavigationItem
                ) {
                    sendFile = this.props.appStore.history.sendFileStatus;
                }
            } else {
                sendFile = (
                    <ButtonAction
                        icon="material:file_upload"
                        text="Send File"
                        onClick={this.instrument.sendFileToInstrumentHandler}
                        title="Send file to instrument"
                        className={"btn-primary"}
                    ></ButtonAction>
                );
            }
        }

        let toolbarButtons =
            this.props.selectedItem && this.props.selectedItem.renderToolbarButtons();

        return (
            <ConnectionBar>
                <div>
                    <img src={this.instrument.image} draggable={false} />
                </div>

                <div>
                    <div>{this.instrument.name}</div>
                    {connectionStatus}
                </div>

                <div>{sendFile}</div>

                <Toolbar>{toolbarButtons}</Toolbar>
            </ConnectionBar>
        );
    }
}

////////////////////////////////////////////////////////////////////////////////

@observer
export class App extends React.Component<{ appStore: InstrumentAppStore }> {
    constructor(props: any) {
        super(props);
    }

    @bind
    onSelectionChange(item: IInstrumentWindowNavigationItem) {
        this.props.appStore.navigationStore.mainNavigationSelectedItem = item;
    }

    @computed
    get appBar() {
        const instrument = this.props.appStore.instrument;
        if (!instrument) {
            return undefined;
        }

        return (
            <div>
                {instrument.connection.error && (
                    <AlertDanger
                        className="mb-0"
                        onDismiss={() => instrument.connection.dismissError()}
                    >
                        {instrument.connection.error}
                    </AlertDanger>
                )}
                {
                    <AppBar
                        appStore={this.props.appStore}
                        selectedItem={
                            this.props.appStore.navigationStore.mainNavigationSelectedItem
                        }
                    />
                }
            </div>
        );
    }

    render() {
        return (
            <AppRootComponent
                navigationItems={this.props.appStore.navigationStore.navigationItems}
                appBar={this.appBar}
                selectedItem={this.props.appStore.navigationStore.mainNavigationSelectedItem}
                onSelectionChange={this.onSelectionChange}
            />
        );
    }
}
