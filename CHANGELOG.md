# Release Notes

## 3.0.1 (2023-??-??)

* Add support for the ``${command:platformio-ide.activeEnvironment}`` variable that can be used in a custom [PlatformIO Toolbar](https://docs.platformio.org/en/latest/integration/ide/vscode.html#platformio-toolbar) and [VSCode variable substitution](https://code.visualstudio.com/docs/editor/variables-reference) (issue [#1697](https://github.com/platformio/platformio-vscode-ide/issues/1697))
* Focus on the project configuration output tab only on error (issue [#3535](https://github.com/platformio/platformio-vscode-ide/issues/3535))
* Fixed an issue with a task runner on Windows 7 (issue [#3481](https://github.com/platformio/platformio-vscode-ide/issues/3481))
* Fixed "Select All", "Undo", and "Redo" operations on macOS for PIO Home (pull [#3451](https://github.com/platformio/platformio-vscode-ide/pull/3451))
* Fixed an issue when the "Upload & Monitor" task selects the wrong environment (issue [#2623](https://github.com/platformio/platformio-vscode-ide/issues/2623))

## 3.0.0 (2023-02-01)

**Requires PlatformIO Core 6.1.6 + VSCode 1.65 or above**

### Project Management

* IntelliSense for [platformio.ini](https://docs.platformio.org/en/latest/projectconf/index.html) configuration file
  - Auto-completion for configuration options
  - Auto-completion for choice-based option values
  - Hover over the option and get a quick documentation
  - Realtime serial port auto-completion for port-related options
  - Quickly jump to the development platform or library located in the PlatformIO Registry
* Native integration of [PlatformIO Unit Testing](https://docs.platformio.org/en/latest/advanced/unit-testing/index.html) with VSCode Testing UI
* New port switcher to override upload, monitor, or testing port (issue [#545](https://github.com/platformio/platformio-vscode-ide/issues/545))
* Advanced project configuring progress with logging and canceling features

### Navigation

* Added support for the macOS Touch Bar (issue [#311](https://github.com/platformio/platformio-vscode-ide/issues/311))
* Added "Build/Upload/Test/Clean" and "Serial Monitor" buttons to the Editor title bar
* Configure custom buttons and commands in PlatformIO Toolbar with a new `platformio-ide.toolbar` configuration option (issue [#1697](https://github.com/platformio/platformio-vscode-ide/issues/1697))

### UX/UI Improvements

* Added walkthroughs (Menu: Help > Get Started) to introduce users to the features of the PlatformIO ecosystem
* Provide PlatformIO IDE Release Notes (issue [#2412](https://github.com/platformio/platformio-vscode-ide/issues/2412))
* Activate PlatformIO IDE extension when intending to use PlatformIO (issue [#66](https://github.com/platformio/platformio-vscode-ide/issues/66))
* Activate keyboard shortcuts when PlatformIO Project is opened (issue [#3324](https://github.com/platformio/platformio-vscode-ide/issues/3324))

### Miscellaneous

* Changed Default PIO Home port range from "8010..8100" to "45000..45999"
* Fixed an issue with "'platformio-ide.build' not found" (issue [#1398](https://github.com/platformio/platformio-vscode-ide/issues/1398))

## 2.0.0-2.5.5

See [PlatformIO IDE 2.0 Changelog](https://github.com/platformio/platformio-vscode-ide/blob/v2.5.5/CHANGELOG.md).
