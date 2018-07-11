# Release Notes

## 0.17.2 (2018-07-11)

- Do not force PIO IDE Terminal to `cmd.exe` on Windows (issue [#76](https://github.com/platformio/platformio-vscode-ide/issues/76))
- [PIO Unified Debugger](http://docs.platformio.org/page/plus/debugging.html): Fixed infinite loading of Peripheral Registers

## 0.17.1 (2018-07-05)

* Improvements for [PIO Unified Debugger](http://docs.platformio.org/page/plus/debugging.html):
  - Do not fetch registers data when Peripherals or Registers views are collapsed
  - Fixed issue with incorrect breakpoint hit in multi-thread environment (RTOS)
* Instruction how to manually create [PIO Core Virtual Environment](http://docs.platformio.org/en/latest/installation.html#virtual-environment)

## 0.17.0 (2018-06-29)

* Improvements for [PIO Unified Debugger](http://docs.platformio.org/page/plus/debugging.html):
  - Set breakpoint while the target is running
  - Show peripheral register description via tooltip (mouse over with delay)
  - Improved debugging for multi thread applications (Espressif ESP32, RTOS-based projects)

## 0.16.2 (2018-06-26)

* Handle PIO Home server errors
* Install `virtualenv` to the global scope if possible
* Skip Python interpreter from MinGW

## 0.16.1 (2018-06-21)

* Fixed an issue with infinite PIO Core installation

## 0.16.0 (2018-06-20)

**Requires VSCode 1.24 or above**

* [Custom Tasks](http://docs.platformio.org/en/latest/ide/vscode.html#custom-tasks) (issue [#89](https://github.com/platformio/platformio-vscode-ide/issues/89))
* Automatically close Serial Port Monitor before uploading/testing (issue [#49](https://github.com/platformio/platformio-vscode-ide/issues/49))
* Added new configuration option `autoCloseSerialMonitor`, which is set to `true` by default
* Added "Report a problem" action/button when error occurs
* Improved PIO Core installer using `pip` as Python module

## 0.15.2 (2018-05-30)

* Reverted back an order of PlatformIO Toolbar (issue [#114](https://github.com/platformio/platformio-vscode-ide/issues/114))
* Fixed issue with customization of built-in PlatformIO tasks (issue [#89](https://github.com/platformio/platformio-vscode-ide/issues/89))

## 0.15.1 (2018-05-26)

* Moved PlatformIO Toolbar to the beginning of the bottom status bar
* Fixed issue when trying to open an opened PIO Home again

## 0.15.0 (2018-05-08)

**Requires VSCode 1.23 or above**

* New UI for [PIO Unified Debugger](http://docs.platformio.org/page/plus/debugging.html):
  - Conditional Breakpoints
  - Expressions and Watchpoints
  - Generic Registers
  - Peripheral Registers
  - Memory Viewer
  - Disassembly
  - Multi-thread support
  - A hot restart of an active debugging session
* Retain PIO Home state when switching between tabs (issue [#32](https://github.com/platformio/platformio-vscode-ide/issues/32))

## 0.14.2 (2018-04-28)

* Fixed "PIP: Could not find a version that satisfies the requirement" (issue [#102](https://github.com/platformio/platformio-vscode-ide/issues/102))

## 0.14.1 (2018-04-09)

* Temporary workaround for urgent VSCode bug in v1.22 with a broken task runner for Windows OS (issue [#97](https://github.com/platformio/platformio-vscode-ide/issues/97))

## 0.14.0 (2018-03-14)

* Initial support for PIO Enterprise
* Speed up the loading of PIO Home [PIO Home](http://docs.platformio.org/page/home/index.html)

## 0.13.2 (2018-03-08)

* Fixed endless loop with installing PIO Core when `platformio-ide.useDevelopmentPIOCore` is set to `false` (issue [#86](https://github.com/platformio/platformio-vscode-ide/issues/86))

## 0.13.1 (2018-03-05)

* Fixed "Cannot read property 'theme' of undefined" when opening [PIO Home](http://docs.platformio.org/page/home/index.html)

## 0.13.0 (2018-03-03)

* Multiple themes (Dark & Light) for [PIO Home](http://docs.platformio.org/page/home/index.html)
* Fixed GitHub's "TLSV1_ALERT_PROTOCOL_VERSION" issue with PIO Core installer (issue [#88](https://github.com/platformio/platformio-vscode-ide/issues/88))

## 0.12.1 (2018-02-05)

* New configuration option `defaultToolbarBuildAction` (default action for 'Build' button on PIO Toolbar), default value is `release`. Possible values are `release` or `pre-debug`.
  To eliminate a full project rebuilding before debugging, please change this value to `pre-debug`

## 0.12.0 (2018-01-30)

* Added a new "Pre-Debug" task and run it before debugging session
* Significantly improved startup time for [PIO Unified Debugger](http://docs.platformio.org/page/plus/debugging.html)

## 0.11.1 (2018-01-23)

* Improved support for PIO Core 3.5.1
* Use a custom HOME environment variable for Windows
* Fixed PIO Core installer when UserName contains a space

## 0.11.0 (2018-01-16)

* Added new option `activateOnlyOnPlatformIOProject` (activate extension only when PlatformIO-based project (with `platformio.ini`) is opened in workspace) (issue [#66](https://github.com/platformio/platformio-vscode-ide/issues/66))
* Changed minimum requirements for Python to 2.7.5+
* Handle correctly conda's virtual environment
* Don't update Terminal configuration with patched PATH environment for non-PlatformIO projects (issue [#64](https://github.com/platformio/platformio-vscode-ide/issues/64))
* Ignore Python interpreter from Cygwin environment (issue [#43](https://github.com/platformio/platformio-vscode-ide/issues/43))

## 0.10.0 (2018-01-11)

* Added PIO Remote & PIO Unit Testing buttons and commands
* Better explanation for "WindowsError: [Error 5]"
* Minor improvements for Project Indexer

## 0.9.1 (2018-01-11)

* Improved support for PIO Core 3.5.1-dev
* Fixed issue with installer (pip, virtualenv) when non-ASCII chars are used in TMPDIR environment variable

## 0.9.0 (2017-12-28)

* Improved support for PIO Core 3.5.0
* Pre-install PIO Home in pair with PIO Core (resolve issue with "timeout")
* Fixed issue with PIO Core update/upgrade commands (issue [#62](https://github.com/platformio/platformio-vscode-ide/issues/62))

## 0.8.2 (2017-12-02)

* Fixed issue with broken PIO Home and user's Python <2.7.9 (Windows). Automatically install compatible Python

## 0.8.1 (2017-11-29)

* New configuration option: "Update Terminal configuration with patched PATH environment", default value is `true`
* Fixed "Expression preceding parentheses of apparent call must have (pointer-to-) function type" for IntelliSense (issue [#54](https://github.com/platformio/platformio-vscode-ide/issues/54))

## 0.8.0 (2017-11-26)

**Requires VSCode 1.18.0 or above**

* Updated PIO Terminal with new VSCode API
* Increased timeout for PIO Home Server

## 0.7.4 (2017-11-03)

* Improved support for non-ASCII locales
* Fixed issue with the missing toolchain includes in `includePath` of IntelliSense

## 0.7.3 (2017-09-09)

* Catch errors when checking PIO Core version (broken PIO Core installation)
* Override LC_ALL only for Darwin platform

## 0.7.2 (2017-09-01)

* Show PIO Home icon on bottom Toolbar even when PIO Project is not opened

## 0.7.1 (2017-09-01)

* Fixed installer issue "Reference Error: atom is not defined" (issue [#38](https://github.com/platformio/platformio-vscode-ide/issues/38))

## 0.7.0 (2017-09-01)

* New in PIO Home:
  - New Project
  - Import Arduino IDE Project
  - Open Project
  - Project Examples
* Migrate to "platformio-node-helpers", a common interface for Node.JS based PlatformIO IDE extensions
* Revert back "Run a task" button on the PIO Toolbar

## 0.6.0 (2017-08-10)

* Integrate new PIO Home 2.0

## 0.5.3 (2017-08-05)

* Ignore broken `node-tar` (3.1.9) package which blocks PIO Core installer

## 0.5.2 (2017-07-27)

* Use dedicated terminal panel per unique PIO Task
* Avoid concurrent "IntelliSense Index Rebuild" processes

## 0.5.1 (2017-07-18)

* Add new Tasks
  - Rebuild C/C++ Project Index
  - Update installed platforms, packages and libraries
  - Upgrade PlatformIO Core
* Use `pio device monitor` command instead of `pio run -t monitor` for "Monitor" task

## 0.5.0 (2017-07-17)

**Requires VSCode 1.13.0 or above**

* Dynamic Tasks (issue [#24](https://github.com/platformio/platformio-vscode-ide/issues/24))
* Custom tasks per project environment based on `platformio.ini` (issue [#16](https://github.com/platformio/platformio-vscode-ide/issues/16))
* Removed "No task is currently running" warning (issue [#26](https://github.com/platformio/platformio-vscode-ide/issues/26))
* Fixed issue with Windows accounts that contain spaces in user name (issue [#27](https://github.com/platformio/platformio-vscode-ide/issues/27))

## 0.4.0 (2017-07-05)

* New `platformio-ide.forceUploadAndMonitor` configuration option which allows to force "Upload and Monitor" task for `platformio-ide.upload` command
* Automatically terminate previous PlatformIO Task before a new (fixes issue with uploading when Serial Monitor is run)

## 0.3.1 (2017-06-28)

* Improved PIO IDE Installer (issue with `virtualenv` and OS temporary directory)
* Added workaround for [Windows command-line string limitation](https://support.microsoft.com/en-us/help/830473/command-prompt-cmd.-exe-command-line-string-limitation)
  (issue [#15](https://github.com/platformio/platformio-vscode-ide/issues/15))

## 0.3.0 (2017-06-05)

* Added default keybindings for the popular commands (Build, Upload, Open Serial Monitor, Initialize New Project, Run Other Tasks)
* Automatically close Serial Monitor before uploading
* Synchronize Installer with the latest version from PIO IDE for Atom
* Don't show PlatformIO Toolbar in non-PlatformIO projects (issue [#6](https://github.com/platformio/platformio-vscode-ide/issues/6))
* Don't replace default terminal with PlatformIO (issue [#9](https://github.com/platformio/platformio-vscode-ide/issues/9))
* Fixed issue with PIO Terminal and Windows PowerShell (issue [#10](https://github.com/platformio/platformio-vscode-ide/issues/10))
* Other improvements and bugfixes

## 0.2.0 (2017-05-29)

* PlatformIO Toolbar in Status Bar (Build, Upload, Clean, Run Tasks, New Project, Serial Monitor, and Terminal)
* Improved auto installer for PIO Core
* Improved C/C++ Code Completion

## 0.1.0 (2017-05-28)

* Initial release
