import * as vscode from 'vscode';
import cp = require('child_process');
import util = require('util');

export async function activate(context: vscode.ExtensionContext) {
	const execFile = util.promisify(cp.execFile);

	// Read the list of targets from TinyGo.
	try {
		const {stdout, stderr} = await execFile('tinygo', ['targets']);
		var targets = stdout.trimRight().split('\n');
	} catch(err) {
		vscode.window.showErrorMessage('Could not list TinyGo targets:\n' + err);
		return;
	}

	// Sort targets by most recently used.
	let history = context.globalState.get<string[]>('history') || [];
	for (let i=history.length-1; i >= 0; i--) {
		if (targets.indexOf(history[i]) < 0)
			continue;
		moveElementToFront(targets, history[i]);
	}

	// Register the command, _after_ the list of targets has been read. This
	// makes sure the user will never see an empty list.
	let disposable = vscode.commands.registerCommand('vscode-tinygo.selectTarget', async () => {
		// Pick a target from the list.
		const target = await vscode.window.showQuickPick(targets, {
			placeHolder: 'pick a target...',
		});
		if (!target) return;

		// Obtain information about this target (GOROOT, build tags).
		let goroot = '';
		let buildTags = '';
		try {
			const {stdout, stderr} = await execFile('tinygo', ['info', target]);
			stdout.trimRight().split('\n').forEach(line => {
				let colonPos = line.indexOf(':');
				if (colonPos < 0) return;
				let key = line.substr(0, colonPos).trim();
				let value = line.substr(colonPos+1).trim();
				if (key == 'cached GOROOT') {
					//vscode.window.showInformationMessage(`cached GOROOT: ` + value);
					goroot = value;
				} else if (key == 'build tags') {
					buildTags = value;
				}
			})
		} catch(err) {
			vscode.window.showErrorMessage(`Could not run 'tinygo info ${target}':\n` + err);
			return;
		}

		// Check whether all properties have been found.
		if (!buildTags) {
			vscode.window.showErrorMessage(`Could not find build tags for ${target}.`);
			return;
		}
		if (!goroot) {
			// The 'cached GOROOT' property was added at a later time.
			vscode.window.showErrorMessage(`Could not find GOROOT variable for ${target}, perhaps you have an older TinyGo version?`);
			return;
		}

		// Update the configuration in the current workspace.
		const config = vscode.workspace.getConfiguration('go', null);
		let envVars = config.get<NodeJS.Dict<string>>('toolsEnvVars', {});
		envVars['GOROOT'] = goroot;
		envVars['GOFLAGS'] = "-tags="+(buildTags.split(' ').join(','));
		config.update('toolsEnvVars', envVars, vscode.ConfigurationTarget.Workspace);

		// Move the just picked target to the top of the list.
		moveElementToFront(targets, target);

		// Save the history of recently used targets.
		moveElementToFront(history, target);
		context.globalState.update('history', history);

		// Success!
		let buttonClicked = await vscode.window.showInformationMessage(`Updated TinyGo target to ${target}. You may need to reload this window for the changes to take effect.`, 'Reload');
		if (buttonClicked === 'Reload') {
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	});

	context.subscriptions.push(disposable);
}

// Look for the first occurence of the value in values and move it to the front
// of the array. If it doesn't exist, add it as a new value to the front of the
// array.
function moveElementToFront(values: string[], value: string) {
	let index = values.indexOf(value);
	if (index > -1) {
		// Remove the old value.
		values.splice(index, 1);
	}
	// Add new value to the front.
	values.unshift(value);
}
