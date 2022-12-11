```ini
; Common configuration
[env]
platform = espressif32@^5
framework = arduino
board = esp32doit-devkit-v1
monitor_speed = 921600
monitor_filter = esp32_exception_decoder
lib_deps =
    nanopb/Nanopb @ ^0.4.6
    infineon/TLV493D-Magnetic-Sensor @ ^1.0.3
build_flags =
    -D ARDUINO_LOOP_STACK_SIZE=2048
    -D CORE_DEBUG_LEVEL=ARDUHAL_LOG_LEVEL_DEBUG
    -Wno-nonnull-compare

; Production environment
[env:release]
build_flags =
    ${env.build_flags}
    -D PRODUCTION=1

; Development environment
[env:develop]
build_type = debug
lib_deps =
    ${env.lib_deps}
    bakercp/PacketSerial @ 1.4.0
debug_extra_cmds =
    set remote hardware-watchpoint-limit 2
```
