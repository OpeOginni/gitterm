import { h, Component } from 'preact';
import { Terminal } from './terminal';
import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import type { ClientOptions, FlowControl } from './terminal/xterm';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const path = window.location.pathname.replace(/[/]+$/, '');
const wsUrl = [protocol, '//', window.location.host, path, '/ws', window.location.search].join('');
const tokenUrl = [window.location.protocol, '//', window.location.host, path, '/token'].join('');

const clientOptions = {
    rendererType: 'webgl',
    disableLeaveAlert: false,
    disableResizeOverlay: false,
    enableZmodem: false,
    enableTrzsz: false,
    enableSixel: false,
    closeOnDisconnect: false,
    isWindows: false,
    unicodeVersion: '11',
} as ClientOptions;

const termOptions = {
    fontSize: 13,
    fontFamily: '"Space Mono", "SFMono-Regular", Menlo, Consolas, monospace',
    theme: {
        foreground: '#e0e0e0',
        background: '#09090b',
        cursor: '#c8a44e',
        black: '#09090b',
        red: '#d81e00',
        green: '#5ea702',
        yellow: '#cfae00',
        blue: '#427ab3',
        magenta: '#89658e',
        cyan: '#00a7aa',
        white: '#dbded8',
        brightBlack: '#686a66',
        brightRed: '#f54235',
        brightGreen: '#99e343',
        brightYellow: '#fdeb61',
        brightBlue: '#84b0d8',
        brightMagenta: '#bc94b7',
        brightCyan: '#37e6e8',
        brightWhite: '#f1f1f0',
    } as ITheme,
    allowProposedApi: true,
} as ITerminalOptions;

const flowControl = {
    limit: 100000,
    highWater: 10,
    lowWater: 4,
} as FlowControl;

interface AppProps {}
interface AppState {}

export class App extends Component<AppProps, AppState> {
    private terminalRef: Terminal | null = null;

    render() {
        return (
            <div class="workspace-shell">
                {/* Brand Bar */}
                <div class="brand-bar">
                    <div class="brand-bar-inner">
                        <div class="brand-mark">
                            <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="4 17 10 11 4 5" />
                                <line x1="12" y1="19" x2="20" y2="19" />
                            </svg>
                            <span class="brand-name">GITTERM</span>
                        </div>
                    </div>
                </div>

                {/* Terminal Container */}
                <div class="terminal-shell">
                    <Terminal
                        ref={ref => {
                            this.terminalRef = ref;
                        }}
                        id="terminal-container"
                        wsUrl={wsUrl}
                        tokenUrl={tokenUrl}
                        clientOptions={clientOptions}
                        termOptions={termOptions}
                        flowControl={flowControl}
                    />
                </div>
            </div>
        );
    }
}
