# Release Notes

## 0.7.0 (2017-??-??)

* New in PIO Home:
  - New Project
  - Import Arduino IDE Project
  - Project Examples
  - Open Project
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
