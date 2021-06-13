import path = require("path");
import { FileType, Range, RelativePattern, Uri, window, workspace } from "vscode";
import { Settings } from "./settings";

export class Refactorer {
    private static headerFileExtRegex = new RegExp(".(hpp|h|hxx)$");

    /**
     * @brief Begins the refactoring process of all the source files.
     * @param renamedFiles Files or folder which have been moved or renamed.
     */
    public async refactor(renamedFiles : ReadonlyArray<{ readonly oldUri: Uri, readonly newUri: Uri }>) : Promise<void> {
        for (const renamedFile of renamedFiles) {
            try {
                if((await workspace.fs.stat(renamedFile.newUri)).type == FileType.Directory) {
                    // TODO: Scan dir for files.
                    let files = await workspace.fs.readDirectory(renamedFile.newUri);
                    for (const file of files)
                        await this.refactorIncludes({oldUri: Uri.file(path.join(renamedFile.oldUri.fsPath, file[0])), newUri: Uri.file(path.join(renamedFile.newUri.fsPath, file[0]))});
                } 
                else 
                    await this.refactorIncludes(renamedFile);
            } catch (error) {
                window.showErrorMessage("Unable to read file: " + renamedFile.newUri.fsPath);
            }
        }
    }

    /**
     * @brief Searches for source files which includes the given file.
     * @param renamedFile 
     */
    private async refactorIncludes(renamedFile : { readonly oldUri: Uri, readonly newUri: Uri }) : Promise<void> {
        // Only C/C++ header will be processed.
        if(Refactorer.headerFileExtRegex.test(renamedFile.newUri.fsPath) || Refactorer.headerFileExtRegex.test(renamedFile.oldUri.fsPath)) {
            // TODO: Find the correct workspace.
            const folder = workspace.workspaceFolders![0];
            const files = await workspace.findFiles(new RelativePattern(folder, "**/*.{hpp,h,hxx,c,cpp,cxx}"));
            
            for (const file of files) {
                if(this.canIgnore(file))
                    continue;

                if(this.isSameFile(file, renamedFile))
                    await this.refactorMovedFile(renamedFile);
                else
                    await this.refactorFile(file, renamedFile);
            }
        }
    }

    /**
     * @brief Refactors a file which includes the renamed or moved file.
     * @param file 
     * @param renamedFile 
     * @returns 
     */
    private async refactorFile(file : Uri, renamedFile : { readonly oldUri: Uri, readonly newUri: Uri }) : Promise<void> {
        let textDocument = await workspace.openTextDocument(file);

        // Gets the old header file name.
        let oldHeaderFile = path.basename(renamedFile.oldUri.fsPath);
        const includeEx = new RegExp("(?:<|\")(.*?" + oldHeaderFile + ")(?:\"|>)");

        let includeMatches = includeEx.exec(textDocument.getText());

        // Rough check if the current file contains an include with the filename of the modified one.
        if(includeMatches !== null) {
            const oldFilepath = workspace.asRelativePath(renamedFile.oldUri);
            let newFilepath = workspace.asRelativePath(renamedFile.newUri);
            const includePath = includeMatches[1];

            // Checks if the founded include references to the modified file.
            if(oldFilepath.indexOf(includePath) == -1)
            {							
                if(path.resolve(path.dirname(file.fsPath), includePath) != renamedFile.oldUri.fsPath)
                    return;
            }

            // Quick'n dirty check if the current include is a relative one.
            const isRelative = includeMatches[0][0] == '"';
            const index = includeMatches.index + 1;

            // Removes from the new file path the general project structure folders.
            Settings.removeFolderFromPath.forEach(removeFolder => {
                if(newFilepath.indexOf(removeFolder + "/") == 0)
                    newFilepath = newFilepath.substr(removeFolder.length + 1)
            });

            if(isRelative)
                newFilepath = path.relative(path.dirname(file.fsPath), renamedFile.newUri.fsPath);

            let textEditor = await window.showTextDocument(textDocument, 1, true);
            let res = await textEditor.edit(editRef => {
                editRef.replace(new Range(textEditor.document.positionAt(index), textEditor.document.positionAt(index + includePath.length)), newFilepath);
            });

            if(res)
                window.showInformationMessage("File: " + file.fsPath + " modified!");
            else
                window.showErrorMessage("Failed to modify " + file.fsPath + "!");
        }
    }

    /**
     * @brief Refactors the includes of the moved file itself.
     * @param file 
     */
    private async refactorMovedFile(file : { readonly oldUri: Uri, readonly newUri: Uri }) : Promise<void> {
        let textDocument = await workspace.openTextDocument(file.newUri.fsPath);
        let textEditor = await window.showTextDocument(textDocument, 1, true);

        const includeEx = new RegExp('"(.*?)"$', "gm");
        let includeMatches : RegExpExecArray | null = null;

        do {
            includeMatches = includeEx.exec(textDocument.getText());
            if(includeMatches) {
                const index = includeMatches.index + 1;
                let fullIncludePath = path.resolve(path.dirname(file.oldUri.fsPath), includeMatches![1]);
                try {
                    // Checks if the file exists.
                    await workspace.fs.stat(Uri.file(fullIncludePath));
                } catch {
                    fullIncludePath = path.join(path.dirname(file.newUri.fsPath), includeMatches![1].split("../").join(""));

                    // If the file can still not found continue the loop.
                    try {
                        await workspace.fs.stat(Uri.file(fullIncludePath));
                    } catch {
                        continue;
                    }
                }

                const newRelativePath = path.relative(path.dirname(file.newUri.fsPath), fullIncludePath);

                let res = await textEditor.edit(editRef => {
                    editRef.replace(new Range(textEditor.document.positionAt(index), textEditor.document.positionAt(index + includeMatches![1].length)), newRelativePath);
                });

                if(res)
                    window.showInformationMessage("File: " + file.newUri.fsPath + " modified!");
                else
                    window.showErrorMessage("Failed to modify " + file.newUri.fsPath + "!");
            }
        } while (includeMatches);
    }

    /**
     * @param file File path
     * @param renamedFile Modified file structure
     * @returns True if file is the same as renamdeFile.oldUri or renamedFile.newUri
     */
     private isSameFile(file : Uri, renamedFile : { readonly oldUri: Uri, readonly newUri: Uri }) : boolean {
        return file.fsPath == renamedFile.oldUri.fsPath || file.fsPath == renamedFile.newUri.fsPath;
    }

    /**
     * @param file 
     * @returns Returns true if the given file can be ignored.
     */
    private canIgnore(file : Uri) : boolean {
        let ignore = false;
        for (const ignoreAble of Settings.excludeDirs) {
            if(workspace.asRelativePath(file).indexOf(ignoreAble) == 0) {
                ignore = true;
                break;
            }
        }

        return ignore;
    }
}