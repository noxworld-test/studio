import * as React from "react";
import { observer } from "mobx-react";

import styled from "eez-studio-shared/ui/styled-components";

////////////////////////////////////////////////////////////////////////////////

const PanelContainer = styled.div`
    flex-grow: 1;
    display: flex;
    flex-direction: column;
`;

const PanelHeader = styled.div`
    flex-grow: 0;
    flex-shrink: 0;
    padding: 3px;
    background-color: ${props => props.theme.panelHeaderColor};
    display: flex;
    flex-direction: row;
    border-bottom: 1px solid ${props => props.theme.borderColor};
    min-height: 38px;

    .btn-toolbar {
        flex-wrap: nowrap;
    }
`;

const PanelTitle = styled.div`
    flex-grow: 1;
    margin-top: 5px;
    margin-left: 5px;
    font-weight: 600;
    color: ${props => props.theme.darkTextColor};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
`;

interface PanelProps {
    id: string;
    title: JSX.Element | string;
    buttons?: JSX.Element[];
    body: JSX.Element | undefined;
}

@observer
export class Panel extends React.Component<PanelProps> {
    render() {
        let title: JSX.Element;
        if (typeof this.props.title == "string") {
            title = <PanelTitle>{this.props.title}</PanelTitle>;
        } else {
            title = this.props.title;
        }

        return (
            <PanelContainer>
                <PanelHeader>
                    {title}
                    <div className="btn-toolbar" role="toolbar">
                        {this.props.buttons}
                    </div>
                </PanelHeader>
                {this.props.body}
            </PanelContainer>
        );
    }
}
