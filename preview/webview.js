'use strict';

let messageHandler;
let schematic;

// Obtain a handle to the VS Code API.
let vscode = acquireVsCodeApi();

// Check whether we're actually restoring panel state instead of loading a
// completely new preview panel.
let state = vscode.getState();
if (state) {
    // We've got a state from a previous run.
    // Restore it and signal we're ready.
    start(state);
}

onmessage = async function(e) {
    if (e.data.type === 'start') {
        // This is a fresh new webview, not one restored from an existing state.
        // Therefore, save the state to start with.
        state = e.data.state;
        saveState();
        start(e.data.state);
    } else if (e.data.type === 'compiling') {
        document.querySelector('#schematic').classList.add('compiling');
        terminal.clear('Compiling...');
    } else if (e.data.type === 'loading') {
        // Compiled, loading the program now.
        terminal.clear('Loading...');
    } else if (e.data.type === 'started') {
        // Message is sent right before actually starting the program.
        document.querySelector('#schematic').classList.remove('compiling');
        terminal.clear('Running...');
    } else if (e.data.type === 'notifyUpdate') {
        // Worker notifies us that there are pending updates.
        // Wait for the browser to tell us to update the screen.
        requestAnimationFrame(() => {
            vscode.postMessage({
                type: 'getUpdate',
            });
        });
    } else if (e.data.type === 'properties') {
        // Set properties in the properties panel at the bottom.
        schematic.setProperties(e.data.properties);
    } else if (e.data.type === 'update') {
        // Received updates. Apply them to the webview.
        schematic.update(e.data.updates);
    } else if (e.data.type === 'error') {
        terminal.showError(e.data.message);
    } else {
        console.log('unknown message:', e.data);
    }
};

async function start(state) {
    schematic = new Schematic(state);
    await schematic.refresh();
    vscode.postMessage({
        type: 'ready',
        workerConfig: schematic.configForWorker(),
    });
}

function workerPostMessage(message) {
    vscode.postMessage(message);
}

function saveState() {
    vscode.setState(state);
}
