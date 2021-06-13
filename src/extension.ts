import path = require('path');
import * as vscode from 'vscode';
import { Refactorer } from './refactorer';

export function activate(context: vscode.ExtensionContext) {
	console.log("Start");

	let disposable = vscode.workspace.onDidRenameFiles(async (ev : vscode.FileRenameEvent) => {
		let refactorer = new Refactorer();
		refactorer.refactor(ev.files);
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
