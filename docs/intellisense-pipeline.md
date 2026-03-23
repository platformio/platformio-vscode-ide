# IntelliSense Pipeline

This document describes the end-to-end data flow that produces working C/C++ IntelliSense for PlatformIO projects, from initial trigger through CLI execution to the final state consumed by the language server. The pipeline differs significantly between the **cpptools** and **clangd** backends.

## Components Involved

| Component | Role |
|-----------|------|
| **VS Code Extension** (`src/project/manager.js`) | Creates `ProjectPool`, wires callbacks, triggers project switches |
| **pioarduino-node-helpers** (`ProjectPool` → `ProjectObserver` → `ProjectIndexer`) | Orchestrates project lifecycle, watches `platformio.ini` and library directories, spawns CLI commands |
| **PlatformIO CLI** (`pio`) | Generates `c_cpp_properties.json` or `compile_commands.json` |
| **VS Code Extension** (`src/intellisense.js`) | Post-processes `compile_commands.json` (clangd only), configures backend settings |
| **Language Server** (cpptools or clangd) | Consumes the generated files and provides IntelliSense |

## Trigger Points

The IntelliSense index is rebuilt in two situations:

1. **Project activation** — when the user opens a project or switches environments, `ProjectManager.switchToProject()` calls `this._pool.switch(projectDir)`, which activates the `ProjectObserver` and triggers `ProjectIndexer.rebuildIndex()`.

2. **File system changes** — the `ProjectObserver` watches `platformio.ini` and library directories. When changes are detected, `rebuildIndex()` is triggered again (with a debounce delay for config changes).

## Pipeline: cpptools Backend

```text
┌─────────────────────────────────────────────────────────────────────┐
│ 1. TRIGGER                                                         │
│    ProjectManager.switchToProject(projectDir)                      │
│    └─► pool.switch(projectDir)                                     │
│        └─► ProjectObserver.activate()                              │
│            └─► ProjectIndexer.rebuildIndex()                       │
│                                                                    │
│ 2. CLI COMMAND RESOLUTION                                          │
│    resolveRebuildArgs(selectedEnv, ide, intelliSenseBackend)       │
│    └─► intelliSenseBackend.rebuildArgs(env)                        │
│        └─► ["project", "init", "--ide", "vscode"]                  │
│            (+ ["--environment", env] if env is set)                │
│                                                                    │
│ 3. CLI EXECUTION                                                   │
│    getPIOCommandOutput(args)                                       │
│    └─► Spawns: pio project init --ide vscode [--environment env]   │
│                                                                    │
│ 4. CLI OUTPUT                                                      │
│    PlatformIO internally:                                          │
│    ├─► Reads board/framework metadata                              │
│    ├─► Generates .pio/build/<env>/idedata.json (intermediate)      │
│    └─► Writes .vscode/c_cpp_properties.json                        │
│        (include paths, defines, compiler path, C/C++ standard)     │
│                                                                    │
│ 5. CALLBACK                                                        │
│    onDidRebuildIndex(projectDir)                                   │
│    ├─► fixupCompileCommands(projectDir)                            │
│    │   └─► Returns immediately (backend !== "clangd")              │
│    ├─► ensureClangdArgs(projectDir)                                │
│    │   └─► Returns immediately (backend !== "clangd")              │
│    └─► notifyRescanBackend()                                       │
│        └─► Executes "C_Cpp.RescanWorkspace" command                │
│                                                                    │
│ 6. LANGUAGE SERVER                                                 │
│    Microsoft C/C++ extension reads c_cpp_properties.json           │
│    └─► IntelliSense active                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Points — cpptools

- The PlatformIO CLI does **all the heavy lifting**. It resolves include paths, defines, and compiler settings from the board and framework configuration and writes `c_cpp_properties.json` directly.
- `idedata.json` is an **intermediate artifact** created by the CLI inside `.pio/build/<env>/`. The VS Code extension never reads it — it is consumed internally by the CLI to produce `c_cpp_properties.json`.
- The `onDidRebuildIndex` callback has **no effect** for cpptools — both `fixupCompileCommands()` and `ensureClangdArgs()` return immediately because the active backend is not clangd.
- The only post-processing action is `notifyRescanBackend()`, which tells cpptools to re-read its configuration via `C_Cpp.RescanWorkspace`.

## Pipeline: clangd Backend

```text
┌─────────────────────────────────────────────────────────────────────┐
│ 1. TRIGGER                                                         │
│    ProjectManager.switchToProject(projectDir)                      │
│    └─► pool.switch(projectDir)                                     │
│        └─► ProjectObserver.activate()                              │
│            └─► ProjectIndexer.rebuildIndex()                       │
│                                                                    │
│ 2. CLI COMMAND RESOLUTION                                          │
│    resolveRebuildArgs(selectedEnv, ide, intelliSenseBackend)       │
│    └─► intelliSenseBackend.rebuildArgs(env)                        │
│        └─► ["run", "--target", "compiledb"]                        │
│            (+ ["--environment", env] if env is set)                │
│                                                                    │
│ 3. CLI EXECUTION                                                   │
│    getPIOCommandOutput(args)                                       │
│    └─► Spawns: pio run --target compiledb [--environment env]      │
│                                                                    │
│ 4. CLI OUTPUT                                                      │
│    PlatformIO generates compile_commands.json in the project root  │
│    (contains command/arguments, file, directory for each TU)       │
│                                                                    │
│ 5. CALLBACK — onDidRebuildIndex(projectDir)                        │
│                                                                    │
│    5a. fixupCompileCommands(projectDir)                             │
│        ├─► Read & parse compile_commands.json                      │
│        ├─► For each entry:                                         │
│        │   ├─► Tokenize command string → argv array (if needed)    │
│        │   ├─► Resolve bare compiler name → absolute path          │
│        │   ├─► Absolutize include paths (-I, -isystem, etc.)       │
│        │   └─► Write back as "arguments" array (delete "command")  │
│        ├─► Synthesize entries for uncovered project files           │
│        │   ├─► Find template entry (richest include set)           │
│        │   ├─► Walk project tree for .h/.hpp/.c/.cpp/.cc/.cxx/.ino │
│        │   └─► Clone template argv for each missing file           │
│        └─► Write modified compile_commands.json                    │
│                                                                    │
│    5b. ensureClangdArgs(projectDir)                                │
│        ├─► Set --compile-commands-dir=<projectDir>                 │
│        └─► Set --query-driver=<packages/toolchain-*/bin/*,...>      │
│                                                                    │
│    5c. ensureLaunchJson(projectDir)                                │
│        └─► Create .vscode/launch.json if it does not exist         │
│            (needed because `pio run --target compiledb` does not   │
│             generate it, unlike `pio project init --ide vscode`)   │
│                                                                    │
│    5d. notifyRescanBackend()                                       │
│        └─► Executes "clangd.restart" command                       │
│                                                                    │
│ 6. LANGUAGE SERVER                                                 │
│    clangd reads compile_commands.json                              │
│    ├─► Parses "arguments" arrays (preferred over "command")        │
│    ├─► Queries cross-compiler via --query-driver for system headers│
│    └─► IntelliSense active                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Points — clangd

- The PlatformIO CLI generates a **raw** `compile_commands.json`. Unlike cpptools, this file requires post-processing before clangd can use it effectively with embedded toolchains.
- **`fixupCompileCommands()`** is the core post-processing step. It transforms entries from `command` strings to `arguments` arrays to avoid platform-specific shell-quoting issues, resolves compiler paths so `--query-driver` can match them, and synthesizes entries for files that PlatformIO did not compile but that need IntelliSense coverage.
- **`ensureClangdArgs()`** configures VS Code's `clangd.arguments` workspace setting so clangd knows where to find the compilation database and which compilers to query for system include paths.
- **`--query-driver`** is critical for embedded development — without it, clangd cannot discover GCC/Clang built-in headers (e.g. `<stdint.h>`, `<Arduino.h>` from sysroot) because the cross-compiler is not in the system PATH.

## Backend Configuration Injection

The `intelliSenseBackend` object passed to `ProjectPool` determines which CLI command is used. It is defined in `src/constants.js`:

```js
// cpptools backend
rebuildArgs: (env) => ['project', 'init', '--ide', 'vscode', ...(env ? ['--environment', env] : [])]

// clangd backend
rebuildArgs: (env) => ['run', '--target', 'compiledb', ...(env ? ['--environment', env] : [])]
```

`pioarduino-node-helpers` calls `intelliSenseBackend.rebuildArgs(selectedEnv)` inside `resolveRebuildArgs()` to get the CLI arguments. This design means the node-helpers library is **backend-agnostic** — it does not know or care which IntelliSense engine is active.

## Data Flow Comparison

| Aspect | cpptools | clangd |
|--------|----------|--------|
| CLI command | `pio project init --ide vscode` | `pio run --target compiledb` |
| Generated artifact | `c_cpp_properties.json` | `compile_commands.json` |
| Post-processing needed | No | Yes (`fixupCompileCommands`) |
| Intermediate files | `idedata.json` (CLI-internal) | None |
| Compiler path resolution | Done by CLI | Done by extension |
| Include path resolution | Done by CLI | Done by extension |
| Synthetic file entries | Not needed | Generated by extension |
| clangd arguments | Not applicable | `--compile-commands-dir`, `--query-driver` |
| Rescan command | `C_Cpp.RescanWorkspace` | `clangd.restart` |

## Sequence Diagram

### Project Activation (applies to both backends)

```text
User opens project
       │
       ▼
ProjectManager.switchToProject(projectDir)
       │
       ▼
ProjectPool.switch(projectDir)
       │
       ├─► Deactivate previous ProjectObserver
       └─► Activate target ProjectObserver
              │
              ▼
       ProjectIndexer.rebuildIndex()
              │
              ▼
       resolveRebuildArgs(env, ide, backend)
              │
              ▼
       getPIOCommandOutput(args)          ◄── spawns PlatformIO CLI
              │
              ▼
       onDidRebuildIndex(projectDir)      ◄── callback to VS Code extension
              │
              ├─► fixupCompileCommands()  ◄── clangd only
              ├─► ensureClangdArgs()      ◄── clangd only
              ├─► ensureLaunchJson()      ◄── creates launch.json if missing
              └─► notifyRescanBackend()   ◄── both backends
```

### File System Watch (automatic re-indexing)

```text
platformio.ini changed    OR    Library directory changed
          │                              │
          ▼                              ▼
onDidChangeProjectConfig()     FS watcher callback
          │                              │
          ▼                              ▼
switchToProject(dir, force)    rebuildIndex({ delayed: true })
          │                              │
          └──────────┬───────────────────┘
                     ▼
            Same pipeline as above
```
