import * as vscode from 'vscode';
import * as path from 'path';
import {promises as fs} from 'fs';
import {Compiler} from './compiler';

// List of targets that have an accompanying board usable for preview.
let boards = [
    'arduino',
    'arduino-nano33',
    'circuitplay-bluefruit',
    'circuitplay-express',
    'hifive1b',
    'microbit',
    'pinetime',
    'reelboard',
];

function hasPreview(target: string): boolean {
    if (boards.includes(target)) {
        return true;
    }
    // TODO: search through tags
    return false;
}

// updateStatus updates whether the preview button should be shown. It must be
// called every time the tinygo target has changed.
export function updateStatus(context: vscode.ExtensionContext) {
    let target = context.workspaceState.get('tinygo-target', '-');
    vscode.commands.executeCommand('setContext', 'tinygoHasPreview', hasPreview(target));
}

// createNewPanel creates a new preview webview in a panel.
export async function createNewPane(context: vscode.ExtensionContext, uri: vscode.Uri) {
    // Determine the full (absolute) path of the Go package of this file.
    if (uri.scheme !== 'file') {
        vscode.window.showErrorMessage('Cannot preview non-local packages.');
        return;
    }
    let packageFullPath = path.dirname(uri.fsPath);

    const panel = vscode.window.createWebviewPanel(
        'vscode-tinygo.preview',
        'TinyGo Preview',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            localResourceRoots: [
                // Only allow access to the 'preview' subdirectory.
                vscode.Uri.file(path.join(context.extensionPath, 'preview')),
            ],
            retainContextWhenHidden: true, // TODO: try to avoid this, somehow
        },
    );

    // Construct the initial state for the webview.
    let target = context.workspaceState.get('tinygo-target', '-');
    panel.webview.postMessage({
        type: 'init',
        state: {
            parts: {
                main: {
                    location: 'parts/'+target+'.json',
                    x: 0,
                    y: 0,
                },
            },
            wires: [],
            target: target,
            packageFullPath: packageFullPath,
        }
    });

    await createPanel(context, panel, target, packageFullPath);
}

// Object used to restore previews when VS Code is restarted.
export class PreviewSerializer implements vscode.WebviewPanelSerializer {
    context: vscode.ExtensionContext;
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: any) {
        if (!state) {
            // Should not happen, it probably indicates a bug somewhere.
            // It _might_ happen when closing VSCode before the webview is fully
            // loaded.
            console.warn('no saved state for the webview?', state);
            panel.dispose();
            return;
        }
        await createPanel(this.context, panel, state.target, state.packageFullPath);
    }
}

// createPanel constructs an already created panel and maintains its lifecycle.
// It can be called when creating a new panel or when restoring an existing
// panel.
async function createPanel(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, target: string, packageFullPath: string) {
    // Create a new webview for the preview.
    let panelDisposed = false;

    // Load the HTML into the webview.
    const basePath = vscode.Uri.file(path.join(context.extensionPath, 'preview/playground/'));
    const baseUrl = panel.webview.asWebviewUri(basePath);
    let html = await fs.readFile(path.join(context.extensionPath, 'preview', 'webview.html'), 'utf8');
    html = html.replace('{PLAYGROUND_PATH}', baseUrl.toString());
    // Note: we require "style-src: 'unsafe-inline'" for modifying the CSS of
    // the SVG files. This isn't much of a security concern because the CSP
    // below disallows loading from an external source.
    // Also, the worker shouldn't be sending invalid styles anyway (if the
    // worker is hijacked, security is breached anyway).
    // More information: https://stackoverflow.com/questions/30653698/#31759553
    html = html.replace('{CSP}', `default-src ${panel.webview.cspSource}; script-src ${panel.webview.cspSource} blob: 'unsafe-eval'; style-src ${panel.webview.cspSource} 'unsafe-inline'; connect-src ${panel.webview.cspSource}`);
    panel.webview.html = html;

    // Wrapper postMessage that ignores messages after the panel is disposed.
    // Due to race conditions, it is possible that some messages arrive after
    // the compiler or worker have been stopped.
    let panelPostMessage = function(message: any) {
        if (!panelDisposed) {
            panel.webview.postMessage(message);
        }
    };

    // Handle messages coming from the webview.
    panel.webview.onDidReceiveMessage(message => {
        if (message.type === 'ready') {
            // Start compiling the binary that will be displayed in the webview.
            runCompiler();
        } else {
            console.warn('unknown message from panel:', message);
        }
    });

    // Make sure we clean up resources when the panel is disposed (closed).
    panel.onDidDispose(
        () => {
            if (compiler) {
                compiler.kill();
                compiler = undefined;
            }
            watcher.dispose();
            panelDisposed = true;
        },
        null,
        context.subscriptions,
    );

    // Recompile every time a Go file changes.
    // This even includes changes made by external programs!
    let watcher = vscode.workspace.createFileSystemWatcher('**/*.go');
    watcher.onDidChange(
        () => {
            if (compiler) {
                compiler.kill();
                compiler = undefined;
            }
            runCompiler();
        },
        null,
        context.subscriptions,
    );

    let compiler: Compiler | undefined;
    let runCompiler = async function() {
        // Start from a blank slate.
        if (compiler) {
            compiler.kill();
            compiler = undefined;
        }

        // Compile binary.
        panel.webview.postMessage({
            type: 'compiling',
        });
        compiler = new Compiler(context, packageFullPath, [target.replace('-', '_')]);
        let binary;
        try {
            binary = await compiler.compile();
        } catch (e: any) {
            panel.webview.postMessage({
                type: 'error',
                message: e,
            });
        }
        if (!binary) {
            // Compilation was killed or there was an error.
            return;
        }

        // Send the file to the worker for execution.
        panelPostMessage({
            type: 'run',
            binary: binary,
        });
    };
}
