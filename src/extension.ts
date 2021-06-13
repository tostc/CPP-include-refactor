import path = require('path');
import * as vscode from 'vscode';

/**
 * @param file File path
 * @param renamedFile Modified file structure
 * @returns True if file is the same as renamdeFile.oldUri or renamedFile.newUri
 */
function isSameFile(file : vscode.Uri, renamedFile : { readonly oldUri: vscode.Uri, readonly newUri: vscode.Uri }) {
	return file.fsPath == renamedFile.oldUri.fsPath || file.fsPath == renamedFile.newUri.fsPath;
}

export function activate(context: vscode.ExtensionContext) {
	console.log("Start");

	vscode.workspace.onDidRenameFiles(async (ev : vscode.FileRenameEvent) => {
		const regex = new RegExp(".(hpp|h|hxx)$");
		const renamedFiles = ev.files;

		// TODO: Find the correct workspace.
		const folder = vscode.workspace.workspaceFolders![0];
		const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*.{hpp,h,hxx,c,cpp,cxx}"));
		const ignoreThirdParty = ["external", "externals", "third_party", "third_parties"];

		for (const renamedFile of renamedFiles) {
			if(regex.test(renamedFile.newUri.fsPath) || regex.test(renamedFile.oldUri.fsPath)) {
				console.log(renamedFile);

				for (const file of files) {
					let ignore = false;
					for (const ignoreAble of ignoreThirdParty) {
						if(vscode.workspace.asRelativePath(file).indexOf(ignoreAble) == 0) {
							ignore = true;
							break;
						}
					}

					if(ignore)
						continue;

					// Resolves all includes for the current moved file.
					if(isSameFile(file, renamedFile))
					{
						let textDocument = await vscode.workspace.openTextDocument(file);
						let textEditor = await vscode.window.showTextDocument(textDocument, 1);

						const includeEx = new RegExp('"(.*?)"$', "gm");
						let includeMatches : RegExpExecArray | null = null;

						do {
							includeMatches = includeEx.exec(textDocument.getText());
							if(includeMatches) {
								// matches.push(includeMatches);
								const index = includeMatches.index + 1;
								let fullIncludePath = path.resolve(path.dirname(renamedFile.oldUri.fsPath), includeMatches![1]);
								try {
									// Checks if the file exists.
									await vscode.workspace.fs.stat(vscode.Uri.file(fullIncludePath));
								} catch {
									fullIncludePath = path.join(path.dirname(renamedFile.newUri.fsPath), includeMatches![1].split("../").join(""));

									// If the file can still not found continue the loop.
									try {
										await vscode.workspace.fs.stat(vscode.Uri.file(fullIncludePath));
									} catch {
										continue;
									}
								}

								const newRelativePath = path.relative(path.dirname(file.fsPath), fullIncludePath);
		
								let res = await textEditor.edit(editRef => {
									editRef.replace(new vscode.Range(textEditor.document.positionAt(index), textEditor.document.positionAt(index + includeMatches![1].length)), newRelativePath);
								});
	
								if(res)
									vscode.window.showInformationMessage("File: " + file.fsPath + " modified!");
								else
									vscode.window.showErrorMessage("Failed to modify " + file.fsPath + "!");
							}
						} while (includeMatches);

						continue;
					}
						
					let textDocument = await vscode.workspace.openTextDocument(file);

					// Gets the old header file name.
					let oldHeaderFile = path.basename(renamedFile.oldUri.fsPath);
					const includeEx = new RegExp("(?:<|\")(.*?" + oldHeaderFile + ")(?:\"|>)");

					let includeMatches = includeEx.exec(textDocument.getText());

					// Rough check if the current file contains an include with the filename of the modified one.
					if(includeMatches !== null) {
						const oldFilepath = vscode.workspace.asRelativePath(renamedFile.oldUri);
						let newFilepath = vscode.workspace.asRelativePath(renamedFile.newUri);
						const includePath = includeMatches[1];

						// Checks if the founded include references to the modified file.
						if(oldFilepath.indexOf(includePath) == -1)
						{							
							if(path.resolve(path.dirname(file.fsPath), includePath) != renamedFile.oldUri.fsPath)
								continue;
						}

						// Quick'n dirty check if the current include is a relative one.
						const isRelative = includeMatches[0][0] == '"';
						const index = includeMatches.index + 1;

						// Removes from the new file path the general  project structure folders.
						const removeFolders = ["include", "inc", "src"];
						removeFolders.forEach(removeFolder => {
							if(newFilepath.indexOf(removeFolder) == 0)
								newFilepath = newFilepath.substr(removeFolder.length + 1)
						});

						if(isRelative)
							newFilepath = path.relative(path.dirname(file.fsPath), renamedFile.newUri.fsPath);

						let textEditor = await vscode.window.showTextDocument(textDocument, 1);
						let res = await textEditor.edit(editRef => {
							editRef.replace(new vscode.Range(textEditor.document.positionAt(index), textEditor.document.positionAt(index + includePath.length)), newFilepath);
						});

						if(res)
							vscode.window.showInformationMessage("File: " + file.fsPath + " modified!");
						else
							vscode.window.showErrorMessage("Failed to modify " + file.fsPath + "!");
					}
				}
			}
		}
	});


	let disposable = vscode.commands.registerCommand('cpp-include-refactor.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
	
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World!');
	  });
	
	  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
