# Changelog

All notable changes to the **pioarduino IDE** VSCode extension are documented in this file.

---

## [1.3.10] - 2026-04-17

### 🐛 Bug Fixes

- **Conflicted extensions warning shown only once** — the warning about conflicting IntelliSense extensions (e.g. cpptools) is now persisted via global state so it no longer appears on every VS Code restart. The warning is permanently dismissed after the user uninstalls the conflicted extensions; clicking "More details" or "Remind later" will still allow it to reappear next session.

---

## [1.3.9] - 2026-04-17

### 🐛 Bug Fixes

- **clangd: fix missing `stdbool.h` and wrong libc++ headers for cross-compilers** — clangd ≥ 18 replaces the cross-compiler's built-in headers with its own host headers, causing false errors such as `'stdbool.h' file not found` and `no type named '_Tp_alloc_type'` in `stl_vector.h`. The extension now generates a `.clangd` config file with `CompileFlags: BuiltinHeaders: QueryDriver`, which tells clangd (≥ 21) to keep the headers reported by `--query-driver` instead of substituting its own.

---

## [1.3.8] - 2026-04-14

### ✨ New Features

- **Automatic Espressif clangd detection** — the extension now automatically discovers and uses Espressif's patched clangd from the PlatformIO packages directory (`tool-clangd-esp` or `toolchain-clang-esp`). This clangd variant has native support for Xtensa and ESP RISC-V custom ISA extensions (`xespv`, `xesploop`, `xespdsp`, etc.) that the upstream clangd does not understand, providing accurate IntelliSense for ESP32 targets.

---

## [1.3.7] - 2026-04-12

### 📦 Dependencies

- Update `pioarduino-vscode-debug` — replaced `xml2js` with `fast-xml-parser`

---

## [1.3.6] - 2026-04-11

### 📦 Dependencies

- Update `pioarduino-node-helpers` to  v12.4.4

---

## [1.3.5] - 2026-04-10

### 🐛 Bug Fixes

- **Upload FileSystem Image and Erase Flash now respect the configured port** — dynamically fetched targets such as `uploadfs` and `erase_flash` were ignoring the port selected in the status bar because `TaskItem.getCoreArgs()` only appends `--upload-port` for tasks that declare `optionalArgs`. The extension now appends `--upload-port` itself for any `--target` whose name starts with `upload` or `erase` ([platformio/platform-espressif32#1582](https://github.com/platformio/platform-espressif32/issues/1582))
- **Port coordination and serial monitor auto-close extended to `erase*` tasks** — `erase_flash` (and similar targets) now wait for subscribers to release the serial port before executing, and the serial monitor is automatically closed beforehand, matching the behaviour of regular upload tasks
- **Upload lifecycle events (`fireWillUpload` / `fireDidUpload`) correctly scoped** — `erase*` targets participate in port coordination but do not emit upload lifecycle events; only genuine upload tasks (`upload`, `uploadfs`, …) set `_ownedUploadTaskId` and trigger `fireDidUpload` on completion
- **Port picker filters noisy ports per platform** — the port switcher quick-pick now hides irrelevant entries before listing:
  - **macOS**: ports matching `*.Bluetooth*` or `*.debug*` are excluded
  - **Linux**: virtual serial ports (`/dev/ttyS*`) and Bluetooth RFCOMM devices (`/dev/rfcomm*`) are excluded
  - **Windows**: ports whose description contains `bluetooth` are excluded

---

## [1.3.4] - 2026-04-09

### ✨ New Features

- **Serial port coordination API** — the extension now exports a public API for other extensions to participate in the upload lifecycle:
  - `onWillUpload` — fires before an upload task starts; subscribers receive a `waitUntil(promise)` callback to delay the upload until they have released the serial port. The upload is aborted if any subscriber rejects.
  - `onDidUpload` — fires after an upload task completes (carries `port` and `exitCode`); subscribers use this to reacquire the serial port.
  - Duplicate emissions are prevented: each `ProjectTaskManager` instance tracks its own owned upload task by ID and only fires `onDidUpload` for exactly that task.

---

## [1.3.3] - 2026-04-06

### 📦 Dependencies

- Update `pioarduino-vscode-debug` to  v1.1.3

---

## [1.3.2] - 2026-03-23

### 🐛 Bug Fixes

- **Debug support for clangd backend**: When using clangd as IntelliSense engine, `launch.json` was not generated because `pio run --target compiledb` (unlike `pio project init --ide vscode`) does not create it. The debugger now automatically runs `pio project init --ide vscode` to generate a complete `launch.json` with resolved `executable`, `toolchainBinDir`, `svdPath`, `preLaunchTask`, and all three debug configurations (PIO Debug, skip Pre-Debug, without uploading)

### 📖 Documentation

- Updated [IntelliSense Pipeline](docs/intellisense-pipeline.md) to document the `ensureLaunchJson` step in the clangd callback chain

---

## [1.3.1] - 2026-03-20

### 📦 Dependencies

- Update `pioarduino-vscode-debug` to  v1.1.2

### 🔧 Maintenance

- Update asm debug JSON for actual ARM/Xtensa/RISC-V

---

## [1.3.0] - 2026-03-19

### ⚠️ Breaking Changes

- **IntelliSense extension is no longer installed automatically.** Users must manually install their preferred C/C++ IntelliSense backend ([cpptools](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) or [clangd](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd))

### 🚀 Features

- **clangd IntelliSense post-processing**: Platform-aware shell tokenizer for `compile_commands.json` that correctly handles backslash escapes on POSIX and preserves Windows paths (matching LLVM's `TokenizeWindowsCommandLine`)
- **Extended include-path handling**: Absolutize relative paths for `-I`, `-isystem`, `-iquote`, and `-idirafter` flags in both joined and separated forms
- **Arguments-first output**: Post-processed entries are written back as `arguments` arrays (preferred by clangd), eliminating shell-quoting ambiguity
- **Synthetic file entries**: Automatically generate compilation database entries for project files not covered by PlatformIO's `compile_commands.json`, using argv-level operations instead of fragile string replacement

### 🔧 Maintenance

- Reduced VSIX package size by excluding unnecessary files from node_modules (`.flow`, `.yml`, `src/`, `bin/`, `LICENSE`, `tsconfig.json`, source maps, minified duplicates)

### 📖 Documentation

- Added [IntelliSense documentation](docs/intellisense.md) covering backend configuration, post-processing steps, platform considerations, and troubleshooting
- Added [IntelliSense Pipeline](docs/intellisense-pipeline.md) describing the full end-to-end data flow for both cpptools and clangd backends
- Updated README with IntelliSense section and documentation links

---

## [1.1.7] - 2026-03-13

### 📦 Dependencies

- Use `pioarduino-vscode-debug` for debugging. Replaces `platformio-vscode-debug`

---

## [1.1.6] - 2026-03-06

### 🚀 Features

- **Plugin conflict detection**: Block extension activation until conflicting PlatformIO IDE extension is resolved
- Removed `pioarduino-ide*.vsix` from `.gitignore` for easier distribution

### 🐛 Bug Fixes

- Fixed syntax of VSCode command registration

---

## [1.1.5] - 2025-10-17

### 🔧 Maintenance

- Bumped version and updated dependencies in `package.json`

---

## [1.1.4] - 2025-10-13

### 🐛 Bug Fixes

- Fixed `uv` install on Windows

### 📦 Dependencies

- Updated `pioarduino-node-helpers` to v12.1.1

---

## [1.1.0] - 2025-08-30

### 🐛 Bug Fixes

- Fixed offline mode operation (#3)
- Attempted fixes for various Windows-specific issues

---

## [1.0.8] - 2025-08-14

### 🐛 Bug Fixes

- Fixes for Windows compatibility issues

---

## [1.0.7] - 2025-08-12

### 🔧 Maintenance

- Version update and internal improvements

---

## [1.0.6] - 2025-01-12

### 🚀 Features

- Extension recommendation system for related extensions (#2)
- Issues now link to the pioarduino repository

### 📦 Dependencies

- Updated dependencies

---

## [1.0.5] - 2025-05-24

### 🐛 Bug Fixes

- Ensured terminal uses UTF-8 codepage
- Set explicit codepage UTF-8 for Windows terminals

---

## [1.0.2] - 2024-09-02

### 🚀 Features

- Custom pioarduino icons (#1)
- Brand renaming throughout the extension

### 🔧 Maintenance

- Integration of `pioarduino-node-helpers`
- Various module updates (`manager.js`, `utils.js`, `home.js`, `tests.js`, `config.js`, `main.js`)

---

## [1.0.0] - 2024-08-18

### 🎉 Initial pioarduino Release

- Forked from PlatformIO IDE and rebranded to **pioarduino IDE**
- Switched to `pioarduino-node-helpers` as the backend helper library
- New package identity as `pioarduino`
- GitHub Actions build pipeline (`build.yml`)
- DevContainer support for development

---

## Pre-Fork History (PlatformIO IDE)

The following versions document the history of the upstream PlatformIO IDE project before the pioarduino fork.

---

## [3.3.3] - 2024-01-26

### 📦 Dependencies

- Updated PlatformIO Core Installer Script to 1.2.2

---

## [3.3.2] - 2023-12-23

### 🔧 Maintenance

- Upgraded bundled Python to 3.11.7 (Windows)
- Reformatted codebase with Prettier 3.0

---

## [3.3.1] - 2023-07-28

### 📦 Dependencies

- Updated PIO Core installer script to 1.2.1

---

## [3.3.0] - 2023-07-10

### 🚀 Features

- Enhanced user experience in the "Project Tasks" view (#3750)
- Added "Serial & UDP Plotter" item to "PlatformIO IDE > Quick Access" menu

### 🐛 Bug Fixes

- Skip missing linting API when ancient PIO Core is used
- Use public PIO Core API to lint configuration files

---

## [3.2.0] - 2023-06-09

### 🚀 Features

- **Configuration Linting**: Powerful linting feature for `platformio.ini` highlighting syntactical and stylistic issues (#3723)
- Reduced VSIX package size by excluding unnecessary files
- Follow VSCode guidelines regarding extension and Webpack bundling

### 🐛 Bug Fixes

- Resolved missing status bar buttons in VSCode 1.79 (#3736)

---

## [3.1.1] - 2023-03-16

### 🚀 Features

- Added `platformio-ide.uploadAndMonitor` command for "Upload and Monitor" (useful for custom PlatformIO Toolbar)

### 🐛 Bug Fixes

- Restored support for macOS Touch Bar (#3659)
- Reverted static `activationEvents` required by VSCode ~1.65.0
- Fixed regression where running the same "monitor" causes "task is already active" notification (#3656)

---

## [3.1.0] - 2023-03-13

### 🚀 Features

- Support for `${command:platformio-ide.activeEnvironment}` variable (#3588, #1697)
- Renamed `platformio-ide.switchProjectEnv` command to `platformio-ide.pickProjectEnv`
- Switched to native PIO Core project config parser
- Improved handling of `autoCloseSerialMonitor` configuration

### 🐛 Bug Fixes

- Fixed "Upload & Monitor" task selecting the wrong environment (#2623)
- Do not automatically close serial monitors for "native" dev-platform (#2623)
- Removed custom "Remote Upload" command

---

## [3.0.0] - 2023-02-01

### 🎉 Major Release

- **PlatformIO Unit Testing** integrated via VSCode Testing API (#3168)
- **IntelliSense for `platformio.ini`** with autocompletion and diagnostics (#3167)
- **Customizable PlatformIO Toolbar** via `platformio-ide.toolbar` configuration (#1697)
- **Port Switcher** to override upload/monitor/test port (#545)
- **Walkthroughs** on Getting Started page to introduce PlatformIO features
- **PlatformIO IDE Release Notes** viewer (#2412)
- Added `platformio-ide.uploadAndMonitor` command (#1697)

### 🐛 Bug Fixes

- Fixed "'platformio-ide.build' not found" error (#1398)
- Fixed "Select All", "Undo", and "Redo" on macOS for PIO Home (#3451)
- Fixed task runner issues on Windows 7 (#3481)
- Focus project configuration output only on error (#3535)
- Activate keyboard shortcuts only when PlatformIO project is opened (#3324)
- Avoided infinite recursion when expanding Windows environment variables
- Changed default PIO Home port range to `45000..45999`

### 🔧 Maintenance

- Ported code to native VSCode `globalState`
- Force ANSI output for PIO Core Testing CLI
- Activate extension only when intending to use PlatformIO (#66)
- Requires PlatformIO Core 6.1.6 or above

---

## [2.5.5] - 2022-10-31

### 🐛 Bug Fixes

- Inherited VSCode Proxy configuration for PlatformIO Core
- Fixed passing `process.env` to child processes (#3287)

---

## [2.5.4] / [2.5.3] - 2022-09-03

### 🐛 Bug Fixes

- Fixed Project Tasks being disabled in VSCode v1.71 (#3299)

---

## [2.5.2] - 2022-08-12

### 🐛 Bug Fixes

- Fixed project tasks with a title not working (#3274)

### 🔧 Maintenance

- Automated extension publishing for multiple targets

---

## [2.5.1] - 2022-07-28

### 🚀 Features

- Project Management improvements
- Show views/commands when project is opened

### 🔧 Maintenance

- Share predownloaded packages with the installer

---

## [2.5.0] - 2022-06-23

### 🚀 Features

- Added support for macOS Touch Bar (#311)
- Show "Build/Upload/Test/Clean" and "Serial Monitor" buttons in editor title bar
- Show PlatformIO service commands in Explorer context menu
- Prevented users from using wrong Build/debug buttons (#3239)
- Disable CPP's debug shortcut (#3229)

### 🐛 Bug Fixes

- Ensure PlatformIO Core installer script is not corrupted (#3084)
- Fixed handling of package registry mirrors (#3222)

### 🔧 Maintenance

- Minimum supported PIO Core is 6.0
- Requires VSCode 1.63 or above
- Removed deprecated "updates" command in favor of project dependency management (#3219)

---

## [2.4.3] - 2022-03-18

### 🐛 Bug Fixes

- Fixed installer asking to install Python on Windows when not needed (#3076)

---

## [2.4.2] - 2022-02-11

### 🐛 Bug Fixes

- Fixed "Error: No such command 'home'" when opening PIO Home (#2923)

---

## [2.4.1] - 2022-02-04

### 🐛 Bug Fixes

- Fixed debugging not starting on Windows (#2925)

---

## [2.4.0] - 2021-11-05

### 🚀 Features

- Automatically switch to newly created project's environment (#2414)
- Named status bars: "PlatformIO: Toolbar" and "PlatformIO: Project Environment Switcher" (#2593)
- Synchronize VSCode workspaces with PlatformIO Home Projects (#1367)
- Start debugging without firmware uploading using `loadMode` launch option

### 🔧 Maintenance

- Updated PlatformIO IDE Installer

---

## [2.3.4] - 2021-10-19

### 🚀 Features

- Start debugging without firmware uploading using `loadMode` launch option

### 📦 Dependencies

- Updated PlatformIO IDE installer

---

## [2.3.3] - 2021-08-14

### 📦 Dependencies

- Updated PlatformIO Core installer to v1.0.3

---

## [2.3.2] - 2021-04-13

### 🚀 Features

- New setting `platformio-ide.pioHomeServerHttpHost` for custom PIO Home host (useful for dockerized environments) (#2465)

### 🐛 Bug Fixes

- No longer raises exception when checking PIO Core updates without Internet (#2398)

---

## [2.3.1] - 2021-03-23

### 🚀 Features

- New setting `platformio-ide.activateProjectOnTextEditorChange` for automatic project activation (#2410)
- New setting `platformio-ide.autoOpenPlatformIOIniFile` to control auto-opening of `platformio.ini` (#2419)

### 🐛 Bug Fixes

- Fixed "Failed to load symbols from executable file" when debugging native/desktop applications
- Do not show "Default" environment when project has no build environments (#2450)
- Automatically activate project environment opened via PIO Home (#2414)

---

## [2.3.0] - 2021-03-03

### 🚀 Features

- Automatically switch to the latest project and environment (#2365, #2344, #2320)
- Show active project in status bar (#2276)
- Open `platformio.ini` from newly added project (#2263)
- Custom Python Package Index URL via `customPyPiIndexUrl` setting
- Added "OpenAPI (Swagger) Editor" extension to conflicted list (#2324)

### 🐛 Bug Fixes

- Fixed debug breakpoints not allowed for Assembly files
- Fixed broken "Default" group of tasks in task explorer
- Fixed infinite IntelliSense index rebuilding (#2363)
- Fixed "Upload and Monitor" not terminating running tasks properly (#2266, #2319)
- Fixed broken IntelliSense index rebuilding for big projects (#2321)

### 🔧 Maintenance

- Refactored to session-based PIO Home backend
- Minimum supported Python version is 3.6

---

## [2.2.1] - 2020-11-12

### 🐛 Bug Fixes

- Fixed regression with debug breakpoints not allowed for Assembly files

---

## [2.2.0] - 2020-11-01

### 🚀 Features

- Refactored "Project Tasks" view (#2018)

### 🐛 Bug Fixes

- Fixed debugger not honoring selected environment (#2203)
- Fixed selected project environment not used for C/C++ index regeneration (#2196)
- Do not reopen device monitor if project build fails (#2197)
- Do not start PIO Home in background without PlatformIO project (reduced startup time)
- Fixed PIO Core CLI terminal session not working after closing

---

## [2.1.3] - 2020-10-17

### 🐛 Bug Fixes

- Fixed regression with debugging solution

---

## [2.1.2] / [2.1.1] - 2020-10-16

### 🐛 Bug Fixes

- Fixed "Webview is disposed" error (#2126)
- Fixed "Cannot find module 'os-tmpdir'" bug
- Do not patch global environment PATH with PlatformIO (#2045, #2046)
- Do not propagate PlatformIO CLI to default VSCode terminal

---

## [2.1.0] - 2020-09-16

### 🚀 Features

- New setting `platformio-ide.autoPreloadEnvTasks` for automatic preloading of project environment tasks (#2004)
- Renamed task view to "Project Tasks"

### 📦 Dependencies

- Updated PlatformIO Core installer to 0.3.5

---

## [2.0.1] - 2020-09-10

### 🐛 Bug Fixes

- Moved "Project Tasks" view back to "PlatformIO" activity (draggable to any location)

---

## [2.0.0] - 2020-09-10

### 🎉 Major Release

- **New PlatformIO Task Explorer** (#1750)
- **New Project Environment Switcher** (#544)
- New PlatformIO Core installer based on `get-platformio.py` script
- Added support for PlatformIO Core 5.0
- Replaced "Generic" group of tasks with "General"

### 🐛 Bug Fixes

- Fixed hotkeys in PIO Home not working on macOS (#606)
- Fixed "ENOENT: no such file or directory, homestate.json"
- Show env switcher only when 2+ items are available

### 🔧 Maintenance

- Minimum supported VSCode version is 1.42
- Minimum dependency for PIO Core is 4.4.0

---

## [1.10.0] - 2019-11-20

### 🚀 Features

- Added "Inspect" and "Projects & Configuration" items to Quick Access (#1302)
- Show "Check available solutions" for known issues

### 🐛 Bug Fixes

- Skip Python from msys, mingw, emacs installations (#1353)

### 🔧 Maintenance

- Minimum requirements for PlatformIO Core is >=4.1.0

---

## [1.9.3] - 2019-10-29

### 🚀 Features

- Handle `openTextDocument` in VSCode from PIO Home 3.0 and Project Inspect
- Use single PIO Home Server instance per multiple windows/sessions

---

## [1.9.2] / [1.9.1] - 2019-10-20

### 🐛 Bug Fixes

- Fixed broken PlatformIO Core installation
- Bug-fixes and improvements for PIO Core installer

---

## [1.9.0] - 2019-10-11

### 🐛 Bug Fixes

- Fixed "breakpoint-hit" not correctly handled in multi-thread applications (RTOS) (#623)
- Fixed debugger breakpoints not activated on new debug session start (#623)

### 🔧 Maintenance

- Use Python 3.7 as default installer for Windows; Python 3 prioritized over Python 2

---

## [1.8.3] - 2019-08-31

### 🐛 Bug Fixes

- Fixed incorrect checking of a valid Python 3 interpreter
- Catch "ModuleNotFoundError: No module named 'distutils'" error

---

## [1.8.2] - 2019-08-11

### 🐛 Bug Fixes

- Temporary workaround for broken Tasks API in VSCode 1.37 (#957)
- Show multi-environment tasks when more than one env is declared

---

## [1.8.1] - 2019-07-23

### 🐛 Bug Fixes

- Fixed "Error: Webview is disposed" when opening PIO Home (#917)
- Fixed broken Code Disassembly feature of PIO Unified Debugger (#920)

### 🚀 Features

- Added new command "Open PlatformIO Core CLI"

---

## [1.8.0] - 2019-07-16

### 🚀 Features

- Option to disable PIO Home at startup (#888)
- New setting `platformio-ide.pioHomeServerHttpPort` for default PIO Home HTTP port (#832)
- New setting `platformio-ide.disableAutostartPIOHomeServer` (#888)
- Automatically remove conflicted extensions (#830)
- Replaced `*.png` icons with `*.svg` (#755)

### 🐛 Bug Fixes

- Close PIO Home when workspace folders are changed (#624)
- Fixed "Cannot read property 'getTreeNode' of null" when reading Generic Registers (#862)
- Fixed PlatformIO Core not handling disabled "Proxy Strict SSL" properly (#837)
- Fixed multiple instances of PIO Home when opening new projects (#624)

### 🔧 Maintenance

- Minimum supported PIO Core is 4.0

---

## [1.7.1] - 2019-04-20

### 🐛 Bug Fixes

- Disabled extension recommendations per workspace (workaround for VSCode issue #58348)

---

## [1.7.0] - 2019-04-16

### 🚀 Features

- Use VSCode's proxy settings by PlatformIO Core (#96)

---

## [1.6.0] - 2018-12-12

### 🚀 Features

- Custom task for "Build" command used by PlatformIO Toolbar and Key Bindings (#116)
- Automatically remove previous PIO Core installation when switching between stable and development versions

### 🐛 Bug Fixes

- Fixed spurious project "Problems" when ARM mbed framework is used (#459)

---

## [1.5.0] - 2018-11-29

### 🔧 Maintenance

- Switched to stable PlatformIO Core
- Updated PlatformIO Core Installer (#436, #154)
- Updated PIO Core to 3.6.2 (minimum supported version)
- Hint about "Please restart VSCode" after PIO Core installation

---

## [1.4.7] / [1.4.6] - 2018-11-23

### 🐛 Bug Fixes

- Warn about using `.ino` files that leads to spurious problems (#400)

---

## [1.4.5] - 2018-11-18

### 🚀 Features

- Reduced startup time using extension bundling (#409)
- Added support for native WebSockets for PIO Home

---

## [1.4.4] / [1.4.3] / [1.4.2] - 2018-10-26

### 🐛 Bug Fixes

- Handle "Error: Could not create PIO Core Virtual Environment"
- Improved PlatformIO Core Installer
- Integrated with Sentry for error reporting

---

## [1.4.1] - 2018-10-19

### 🐛 Bug Fixes

- Shutdown debugging server gracefully on "Stop" command
- Debugger minor tweaks

---

## [1.4.0] - 2018-10-09

### 🚀 Features

- Improved "MEMORY" viewer UI/UX for debugger
- Allow breakpoints in Assembly language
- Added RISC-V and MIPS mnemonics to Assembly grammar
- Notify about conflicted extensions with IntelliSense (#118)

---

## [1.3.1] - 2018-10-02

### 🚀 Features

- Added "Update All (libraries, platforms, packages)" and "Upgrade PlatformIO Core" tasks to global VSCode Task Manager (#335)

### 🐛 Bug Fixes

- Fixed empty call stack when initial breakpoint is disabled

---

## [1.3.0] - 2018-09-21

### 🚀 Features

- Added "Update All" quick access command to PlatformIO Activity sidebar (#335)
- Improvements for PIO Unified Debugger
- Configure Serial Port Monitor reopen delay via `platformio-ide.reopenSerialMonitorDelay`

---

## [1.2.0] - 2018-09-12

### 🚀 Features

- Added "table of contents" of PIO Home to "PlatformIO View > Quick Access"

### 🐛 Bug Fixes

- Fixed CPP files being detected as Arduino

---

## [1.1.1] - 2018-09-07

### 🐛 Bug Fixes

- Fixed extension not starting after adding new project folder to workspace (#319)
- Fixed "ImportError: cannot import name _remove_dead_weakref" and "[Errno 48] Address already in use" (#142, #313)

---

## [1.1.0] - 2018-08-31

### 🚀 Features

- New "Debug" group in "Quick Access" view
- Focus "Explorer" view when adding new project folder
- Improved support for Arduino `.ino` files

---

## [1.0.0] - 2018-08-30

### 🎉 First Stable Release (PlatformIO IDE)

- Support for multi-root workspaces (#50, #107)
- Project Indexer and Task Manager
- New option: Disable PlatformIO Toolbar
- "Update PlatformIO Core packages" command

---

## [0.17.x] - 2018-04 – 2018-08

- PIO Unified Debugger improvements (Peripherals, Registers, Memory viewer)
- Multi-themes (Dark & Light) for PIO Home
- Custom Tasks support (#89)
- Automatically close Serial Port Monitor before uploading/testing (#49)
- Initial PIO Enterprise support
- PIO Home state persistence when switching tabs (#32)

---

## [0.16.x] - 2018-06

- Custom Tasks (#89)
- Automatically close Serial Port Monitor before uploading/testing (#49)
- Improved PIO Core installer using `pip` as Python module

---

## [0.15.x] - 2018-05

- New UI for PIO Unified Debugger
- PlatformIO Toolbar moved to beginning of bottom status bar

---

## [0.14.x] - 2018-03 – 2018-04

- Initial PIO Enterprise support
- Speed up PIO Home loading
- Fixed endless loop with PIO Core installation (#86)

---

## [0.13.x] - 2018-03

- Multi-themes (Dark & Light) for PIO Home
- Fixed GitHub "TLSV1_ALERT_PROTOCOL_VERSION" issue (#88)

---

## [0.12.x] - 2018-01 – 2018-02

- New "Pre-Debug" task
- Default action configuration for "Build" button on PIO Toolbar

---

## [0.11.x] - 2018-01

- New option `activateOnlyOnPlatformIOProject` (#66)
- Ignore Python from Cygwin environment (#43)
- Don't update Terminal configuration for non-PlatformIO projects (#64)
- PIO Remote & PIO Unit Testing icons and commands

---

## [0.10.0] - 2018-01-11

- Added PIO Remote & PIO Unit Testing icons and commands

---

## [0.9.x] - 2017-12 – 2018-01

- Upgraded to PIO Core 3.5.0
- Pre-install PIO Home with PIO Core
- Fixed PIO Core update/upgrade commands (#62)

---

## [0.8.x] - 2017-11 – 2017-12

- Terminal PATH patching configuration option
- Added `__GNUC__` macro by default for VSCode IntelliSense (#54)
- Fixed broken PIO Home with Python <2.7.9 on Windows

---

## [0.7.x] - 2017-08 – 2017-11

- Integrated PIO Home 2.0
- Migrated to `platformio-node-helpers`
- Fixed missing toolchain includes in IntelliSense `includePath`
- Fixed installer "Reference Error: atom is not defined" (#38)

---

## [0.6.0] - 2017-08-10

- Integrated new PIO Home 2.0
- Shutdown PIO Home server on exit

---

## [0.5.x] - 2017-07 – 2017-08

- **Dynamic Tasks Provider** – custom tasks per project environment (#16, #24)
- Renamed "C/C++ Index Rebuild" to "IntelliSense Index Rebuild"
- Dedicated terminal panel per unique PIO Task
- Commands for update and upgrade PIO Core
- Fixed task runner issues on Windows

---

## [0.4.0] - 2017-07-05

- Automatically terminate previous PlatformIO Task before starting a new one (#17, #21)
- Automatically start monitor after upload (#17)

---

## [0.3.x] - 2017-06

- Default keybindings
- Automatically close Serial Monitor before uploading
- Don't show PlatformIO toolbar in non-PlatformIO projects (#6)
- Initialize project without workspace (#11)
- Fix PIO Terminal and Windows PowerShell (#10)
- Don't replace default terminal with PlatformIO (#9)
- Workaround for Windows command-line string limitation (#15)

---

## [0.2.0] - 2017-05-29

- Library Manager command and button in Toolbar
- New button for project initialization
- PIO Terminal instance reuse
- Tasks in status bar (#5)
- Force show installer output channel (#4)

---

## [0.1.0] - 2017-05-28

### 🎉 Initial Release

- Basic PlatformIO IDE features for VSCode
- PlatformIO Terminal
- OS environment variable handling
- VSCode tasks and launch configurations
- Installation notifications