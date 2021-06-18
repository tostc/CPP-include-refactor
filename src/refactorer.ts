import path = require("path");
import { commands, FileType, Range, RelativePattern, TextDocument, Uri, ViewColumn, window, workspace, WorkspaceEdit, WorkspaceFolder } from "vscode";
import { Settings } from "./settings";

export class Refactorer {
    private static _HeaderFileExtRegex = new RegExp(".(hpp|h|hxx)$");

    private _CurrentTextDocument : TextDocument | null = null;
    private _WorkspaceEdit : WorkspaceEdit | null = null;
    private _Workspaces : Map<number, WorkspaceFolder> = new Map<number, WorkspaceFolder>();

    /**
     * @brief Begins the refactoring process of all the source files.
     * @param renamedFiles Files or folder which have been moved or renamed.
     */
    public async refactor(renamedFiles : ReadonlyArray<{ readonly oldUri: Uri, readonly newUri: Uri }>) : Promise<void> {
        await this.refactorIncludes(await this.createIncludeFileList(renamedFiles));
    }
    
    /**
     * @param renamedFiles 
     * @returns Returns an array of files, including files which are inside directories.
     */
    private async createIncludeFileList(renamedFiles : ReadonlyArray<{ readonly oldUri: Uri, readonly newUri: Uri }>) : Promise<{ oldUri: Uri, newUri: Uri }[]> {
        let ret : { oldUri: Uri, newUri: Uri }[] = [];
        
        for (const renamedFile of renamedFiles) {
            this.checkAndAddWorkspace(renamedFile);

            try {
                if((await workspace.fs.stat(renamedFile.newUri)).type == FileType.Directory) {
                    let files = await workspace.fs.readDirectory(renamedFile.newUri);
                    for (const file of files) {
                        // We also want subdirectories.
                        if((await workspace.fs.stat(Uri.file(path.join(renamedFile.newUri.fsPath, file[0])))).type == FileType.Directory) {
                            let tmp = await this.createIncludeFileList([{oldUri: Uri.file(path.join(renamedFile.oldUri.fsPath, file[0])), newUri: Uri.file(path.join(renamedFile.newUri.fsPath, file[0]))}]);
                            ret.push(...tmp);
                        }
                        else
                            ret.push({oldUri: Uri.file(path.join(renamedFile.oldUri.fsPath, file[0])), newUri: Uri.file(path.join(renamedFile.newUri.fsPath, file[0]))});
                    }
                } 
                else 
                    ret.push(renamedFile);
            } catch (error) {
                window.showErrorMessage("Unable to read file: " + renamedFile.newUri.fsPath);
            }
        }
        
        return ret;
    }

    /**
     * @brief Adds a workspace folder to the _Workspaces attribute.
     * @param file 
     */
    private checkAndAddWorkspace(file : { readonly oldUri: Uri, readonly newUri: Uri }) : void {
        let root = workspace.getWorkspaceFolder(file.oldUri);
        if(root !== undefined) {
            if(!this._Workspaces.has(root.index))
                this._Workspaces.set(root.index, root);
        }

        root = workspace.getWorkspaceFolder(file.newUri);
        if(root !== undefined) {
            if(!this._Workspaces.has(root.index))
                this._Workspaces.set(root.index, root);
        }
    }

    /**
     * @brief Searches for source files which includes the given file.
     * @param renamedFile 
     */
    private async refactorIncludes(renamedFiles : { oldUri: Uri, newUri: Uri }[]) : Promise<void> {
        let files : Uri[] = [];
        for (const workspaceRoot of this._Workspaces) {
            let folders = await workspace.findFiles(new RelativePattern(workspaceRoot[1], "**/*.{hpp,h,hxx,c,cpp,cxx}"));
            files.push(...folders);
        }
        this._Workspaces.clear();

        this._WorkspaceEdit = new WorkspaceEdit();
        
        for (const file of files) {
            if(this.canIgnore(file))
                continue;

            this._CurrentTextDocument = await workspace.openTextDocument(file);

            for (const renamedFile of renamedFiles) {
                // Only C/C++ header will be processed.
                if(Refactorer._HeaderFileExtRegex.test(renamedFile.newUri.fsPath) || Refactorer._HeaderFileExtRegex.test(renamedFile.oldUri.fsPath)) {
                    if(this.isSameFile(file, renamedFile))
                        await this.refactorMovedFile(renamedFile);
                    else
                        await this.refactorFile(file, renamedFile);
                }
            }
        }

        let res = await workspace.applyEdit(this._WorkspaceEdit);
        if(res)
            window.showInformationMessage("File(s) refactored!");
        else
            window.showErrorMessage("Failed to refactor file(s)!");
    }

    /**
     * @brief Refactors a file which includes the renamed or moved file.
     * @param file 
     * @param renamedFile 
     * @returns 
     */
    private async refactorFile(file : Uri, renamedFile : { readonly oldUri: Uri, readonly newUri: Uri }) : Promise<void> {
        // Gets the old header file name.
        let oldHeaderFile = path.basename(renamedFile.oldUri.fsPath);
        const includeEx = new RegExp("(?:<|\")(.*?" + oldHeaderFile + ")(?:\"|>)");

        let includeMatches = includeEx.exec(this._CurrentTextDocument!.getText());

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
         
            this._WorkspaceEdit?.replace(file, new Range(this._CurrentTextDocument!.positionAt(index), this._CurrentTextDocument!.positionAt(index + includePath.length)), newFilepath);
        }
    }

    /**
     * @brief Refactors the includes of the moved file itself.
     * @param file 
     */
    private async refactorMovedFile(file : { readonly oldUri: Uri, readonly newUri: Uri }) : Promise<void> {
        const includeEx = new RegExp('"(.*?)"$', "gm");
        let includeMatches : RegExpExecArray | null = null;

        do {
            includeMatches = includeEx.exec(this._CurrentTextDocument!.getText());
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
                this._WorkspaceEdit?.replace(file.newUri, new Range(this._CurrentTextDocument!.positionAt(index), this._CurrentTextDocument!.positionAt(index + includeMatches![1].length)), newRelativePath);
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