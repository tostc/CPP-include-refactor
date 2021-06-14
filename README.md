# cpp-include-refactor

Since every language extension, except the C / C++ extension, has a feature to refactor imports / includes, if you rename or move a file, I've created this extension.

## Features

- Refactors all includes if you move one or more files.
- Refactors all includes if you rename a file.
- Refactors all includes if you move one or more folders.
- Refactors all includes if you rename a folders.

## Extension Settings

This extension contributes the following settings:

* `cppIncludeRefactor.excludeDirs`: An array of directories which shouldn't be scanned.
* `cppIncludeRefactor.removeFolderFromPath`: An array of directories which should removed from the top level directory of a path.

## Known Issues

This extension currently doesn't uses any kind of indexing. So every access (reading / writing) is a direct file access, which can on slower hard drives being slower.

## Release Notes

### 1.0.0

Initial release of cpp-include-refactor.
