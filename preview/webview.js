'use strict';

import { Simulator } from "./playground/simulator.js";

// Obtain a handle to the VS Code API.
let vscode = acquireVsCodeApi();

let simulator = null;
let state = null;

document.addEventListener('DOMContentLoaded', () => {
    // Check whether we're actually restoring panel state instead of loading a
    // completely new preview panel.
    state = vscode.getState();
    if (state) {
        // We've got a state from a previous run.
        // Restore it and signal we're ready.
        init(state);
    }
})

onmessage = async function(e) {
    if (e.data.type === 'init') {
        // This is a fresh new webview, not one restored from an existing state.
        // It needs to be saved now so that closing and reopening VSCode will
        // work correctly.
        state = e.data.state;
        saveState();
        init(e.data.state);
    } else if (e.data.type === 'compiling') {
        // Reinitialize the simulator (draw new parts etc).
        simulator.refresh();
    } else if (e.data.type === 'run') {
        // We get a plain old array from VSCode because the buffer is serialized to
        // JSON. Before sending it along to the worker, convert it to a typed array.
        // There might be a more efficient way to do this (such as loading the
        // binary from within the worker), but this works.
        let buf = new Uint8Array(e.data.binary.data);
        // Start the program.
        simulator.run(buf);
    } else if (e.data.type === 'error') {
        simulator.showCompilerError(e.data.message);
    } else {
        console.log('unknown message:', e.data);
    }
};

async function init(state) {
    // Get a blob URL for the web worker.
    // Apparently the only reasonable way to do this is by using a blob URL that
    // contains all JS files concatenated together.
    // https://code.visualstudio.com/api/extension-guides/webview#using-web-workers
    let result = await fetch('worker/webworker.bundle.js')
    if (!result.ok) {
        throw `could not load Web Worker blob URL: ${result.statusText}`;
    }
    let blob = await result.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Initialize the schematic.
    let root = document.querySelector('#schematic-root');
    simulator = new Simulator({
        root: root,
        workerURL: blobUrl,
        saveState: saveState,
    });
    await simulator.setState(state)
    vscode.postMessage({
        type: 'ready',
    });
}

function saveState() {
    vscode.setState(state);
}
