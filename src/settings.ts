import { workspace } from "vscode";

export class Settings {
    public static get excludeDirs() : string[] {
        let config = workspace.getConfiguration("cppIncludeRefactor");
        if(config.has("excludeDirs"))
            return config.get("excludeDirs")!;

        return [];
    }

    public static get removeFolderFromPath() : string[] {
        let config = workspace.getConfiguration("cppIncludeRefactor");
        if(config.has("removeFolderFromPath"))
            return config.get("removeFolderFromPath")!;

        return [];
    }
}