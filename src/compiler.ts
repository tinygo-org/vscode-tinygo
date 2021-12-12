import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import {promises as fs} from 'fs';

// Compiler wraps the tinygo command.
export class Compiler {
    buildTags: string[];
    context: vscode.ExtensionContext;
    importPath: string;
    process: cp.ChildProcess | undefined;

    constructor(context: vscode.ExtensionContext, importPath: string, buildTags: string[]) {
        this.context = context;
        this.importPath = importPath;
        this.buildTags = buildTags;
    }

    async compile() {
        // Compile to WebAssembly.
        const outputPath = path.join(os.tmpdir(), 'vscode-tinygo-build-' + (Math.random() * 1e12).toFixed() + '.wasm');
        try {
            let promise = new Promise((resolve, reject) => {
                // Both -opt=1 and -no-debug improve compile time slightly.
                this.process = cp.execFile('tinygo', ['build', '-tags='+this.buildTags.join(','), '-opt=1', '-no-debug', '-o='+outputPath],
                {
                    cwd: this.importPath,
                }, (error, stdout, stderr) => {
                    if (error) {
                        reject(stderr);
                    } else {
                        resolve(undefined);
                    }
                });
            });
            await promise;

            // Read the resulting file.
            let binary = await fs.readFile(outputPath);
            return binary;
        } finally {
            // Make sure to remove the file when finished, even if it doesn't
            // exist anymore.
            try {
                fs.unlink(outputPath);
            } catch (e) {
                // ignore any error
            }
        }
    }

    // Stop the compilation process immediately.
    kill() {
        if (this.process) {
            this.process.kill();
            this.process = undefined;
        }
    }
}
