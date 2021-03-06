import React from "react";
import { observer } from "mobx-react";
import { bind } from "bind-decorator";

import { Toolbar } from "eez-studio-ui/toolbar";
import { ButtonAction } from "eez-studio-ui/action";
import { ChartsController } from "eez-studio-ui/chart/chart";

import { Waveform } from "instrument/window/waveform/generic";
import { MultiWaveform } from "instrument/window/waveform/multi";
import { DlogWaveform } from "instrument/window/waveform/dlog";

////////////////////////////////////////////////////////////////////////////////

@observer
export class WaveformToolbar extends React.Component<
    {
        chartsController: ChartsController;
        waveform: Waveform | MultiWaveform | DlogWaveform;
    },
    {}
> {
    @bind
    configureChart() {
        if (!(this.props.waveform instanceof DlogWaveform)) {
            this.props.waveform.openConfigurationDialog();
        }
    }

    render() {
        return (
            <React.Fragment>
                <Toolbar>
                    {!(this.props.waveform instanceof DlogWaveform) && (
                        <ButtonAction
                            text="Configure"
                            className="btn-primary"
                            title="Configure chart"
                            onClick={this.configureChart}
                        />
                    )}
                </Toolbar>
                <Toolbar>
                    <ButtonAction
                        text="Zoom Default"
                        className="btn-secondary"
                        title="Reset zoom and offset to default values"
                        onClick={this.props.chartsController.zoomDefault}
                    />
                    <ButtonAction
                        text="Zoom All"
                        className="btn-secondary"
                        title="Zoom all"
                        onClick={this.props.chartsController.zoomAll}
                    />
                </Toolbar>
            </React.Fragment>
        );
    }
}
