# PlatformIO IDE for VSCode

[![Marketplace Version](https://vsmarketplacebadge.apphb.com/version-short/platformio.platformio-ide.svg)](https://marketplace.visualstudio.com/items?itemName=platformio.platformio-ide) [![Installs](https://vsmarketplacebadge.apphb.com/installs-short/platformio.platformio-ide.svg)](https://marketplace.visualstudio.com/items?itemName=platformio.platformio-ide) [![Rating](https://vsmarketplacebadge.apphb.com/rating-short/platformio.platformio-ide.svg)](https://marketplace.visualstudio.com/items?itemName=platformio.platformio-ide)

[PlatformIO IDE](http://platformio.org/platformio-ide) is the next generation integrated development environment for IoT.

[PlatformIO](http://platformio.org/) is an open source ecosystem for IoT development.
Cross-platform build system and unified debugger. Remote unit testing and firmware updates.

*Atmel AVR & SAM, Espressif 8266 & 32, Freescale Kinetis, Intel ARC32, Lattice iCE40,
Microchip PIC32, Nordic nRF51, NXP LPC, Silicon Labs EFM32, ST STM32,
TI MSP430 & Tiva, Teensy, Arduino, ARM mbed, libOpenCM3, ESP8266, etc.*

## Features

* Cross-platform code builder without external dependencies to a system software:

    - 350+ embedded boards
    - 20+ development platforms
    - 10+ frameworks

* [PIO Unified Debugger](http://docs.platformio.org/page/plus/debugging.html)
* C/C++ Intelligent Code Completion
* C/C++ Smart Code Linter for rapid professional development
* Library Manager for the hundreds popular libraries
* Multi-projects workflow with multiple panes
* Themes support with dark and light colors
* Serial Port Monitor
* Built-in Terminal with PlatformIO Core tool (``pio``, ``platformio``)

## Quick Start

1. Create empty directory and open it as a new project
2. Please be patient and let the installation complete (only the first time, see progress in status bar)
3. Launch VS Code Quick Open (`Ctrl+Shift+P` or `Cmd+Shift+P`), search for `PlatformIO: Initialize or update project`, and press enter
4. Happy coding with PlatformIO!

## How it works

Please follow to the official documentation [PlatformIO IDE for VSCode](http://docs.platformio.org/page/ide/vscode.html).

[![PlatformIO IDE for VSCode](https://raw.githubusercontent.com/platformio/platformio-docs/develop/_static/ide/vscode/platformio-ide-vscode.png)](http://platformio.org/platformio-ide)

## Extension Settings

This extension contributes the following settings:

* `platformio-ide.useBuiltinPIOCore`: Use built-in [PlatformIO Core](http://docs.platformio.org/page/core.html) (default configuration is `true`)
* `platformio-ide.useDevelopmentPIOCore`: Use development version of [PlatformIO Core](http://docs.platformio.org/page/core.html) (default configuration is `false`)
* `platformio-ide.autoRebuildAutocompleteIndex`: Automatically rebuild C/C++ Project Index when [platformio.ini](http://docs.platformio.org/page/projectconf.html) is changed or when new libraries are installed (default configuration is `true`)
* `platformio-ide.customPATH`: Custom PATH for `platformio` command. Paste here the result of `echo $PATH` (Unix) / `echo %PATH%` (Windows) command by typing into your system terminal if you prefer to use custom version of [PlatformIO Core](http://docs.platformio.org/page/core.html) (default configuration is `null`)

## License

Copyright 2017-present PlatformIO <contact@platformio.org>

The PlatformIO IDE for VSCode is licensed under the permissive Apache 2.0 license,
so you can use it in both commercial and personal projects with confidence.
