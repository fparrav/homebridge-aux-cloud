# Changelog

## v0.0.9-beta.1 - 2026-04-26

## Bug fix: AC se mostraba apagado en HomeKit después de encenderlo en modo cloud

### Problema

Al iniciar el AC desde apagado a modo calor usando HomeKit en modo cloud, se escuchaba la interacción del dispositivo pero HomeKit revertía el estado a inactivo (apagado). Solo ocurría cuando la API cloud respondía lento.

### Causa raíz

El *pending guard* que protege el estado optimista local de ser sobreescrito por polls stale tenía un timeout hardcodeado de **4 segundos**. En modo cloud, el comando puede tardar hasta `commandTimeoutMs × (commandRetryCount + 1) ≈ 15 s` por defecto. Cuando el guard expiraba antes de que el comando completara, el siguiente poll traía el estado anterior (AC=OFF) de la caché de la cloud y HomeKit mostraba el dispositivo como inactivo.

En modo LAN el bug no ocurría porque los comandos completan en ~200 ms, bien dentro del window de 4 s.

### Fix

- `isStaleState` ahora usa `Map.has()` en lugar de un chequeo de tiempo hardcodeado de 4 s.
- Los dos `setTimeout` que liberan el guard ahora usan `commandTimeoutMs × (commandRetryCount + 1) + 3 s` (18 s con config por defecto) para cubrir el peor caso de retries.
- `commandRetryCount` y `commandTimeoutMs` se hacen públicos para que los handlers puedan calcular la duración correcta.

## v0.0.8 — Stable release (LAN + Cloud control) - 2026-04-26

## v0.0.8 — Stable Release

**LAN and cloud control fully validated in production.**

This version graduates `0.0.8-beta.x` to a stable release after 22 beta iterations confirming reliability across all three control modes: LAN-only, cloud-only, and cloud+LAN hybrid.

### Highlights

- **LAN-only support**: Control AUX ACs directly over UDP without an AUX Cloud account. Ideal for units kept off the internet to prevent firmware updates that break local control.
- **Cloud + LAN hybrid (local-first)**: Commands go via LAN; cloud is used as automatic fallback after 3 consecutive LAN failures.
- **Cloud-only**: Full cloud support identical to the AC Freedom app experience, including device discovery and multi-family setups.
- **Ambient temperature in HomeKit**: `CurrentTemperature` now reflects the actual room reading from the device (not a fixed default).
- **Correct mode and fan speed on LAN**: Broadlink wire protocol values properly translated to/from AUX API values — heating, cooling, dry, fan modes and all fan speeds work correctly.
- **Fast, parallel polling**: All devices are polled concurrently; one unreachable device does not block others. Effective refresh latency ~33s at 30s interval.
- **Stable cloud commands**: 300ms debounce prevents duplicate commands from multiple HomeKit handlers firing simultaneously.

### Upgrading

No configuration changes required from `0.0.7.x`. If you were on the `beta` tag, this release is now on `latest`.

### Installation

```bash
sudo npm install -g homebridge-aux-cloud
```

## v0.0.8 - 2026-04-25

**Stable release** — LAN and cloud control fully validated in production.

This version graduates `0.0.8-beta.x` to a stable release after 22 beta iterations confirming reliability across all three control modes: LAN-only, cloud-only, and cloud+LAN hybrid.

### Highlights

- **LAN-only support**: Control AUX ACs directly over UDP without an AUX Cloud account. Ideal for units kept off the internet to prevent firmware updates that break local control.
- **Cloud + LAN hybrid (local-first)**: Commands go via LAN; cloud is used as automatic fallback after 3 consecutive LAN failures.
- **Cloud-only**: Full cloud support identical to the AC Freedom app experience, including device discovery and multi-family setups.
- **Ambient temperature in HomeKit**: `CurrentTemperature` now reflects the actual room reading from the device (not a fixed default).
- **Correct mode and fan speed on LAN**: Broadlink wire protocol values properly translated to/from AUX API values — heating, cooling, dry, fan modes and all fan speeds work correctly.
- **Fast, parallel polling**: All devices are polled concurrently; one unreachable device does not block others. Effective refresh latency ~33s at 30s interval.
- **Stable cloud commands**: 300ms debounce prevents duplicate commands from multiple HomeKit handlers firing simultaneously.

### Upgrading

No configuration changes required from `0.0.7.x`. If you were on the `beta` tag, this release is now on `latest`.

---

## v0.0.8-beta.22 - 2026-04-25

fix: remove unused refreshTimer declaration (TypeScript warning cleanup)

## v0.0.8-beta.21 - 2026-04-25

## Fixes

- **Parallel LAN polling**: all devices polled concurrently (Promise.all) instead of sequentially; one unreachable device no longer blocks others
- **Reduced timeouts**: auth 5s→3s, state poll 5s→3s, getInfo 3s→1.5s; total worst-case overhead per cycle: ~10s instead of ~23s
- Net effect: effective refresh latency ~33s at 30s interval (was ~80s)

## v0.0.8-beta.20 - 2026-04-25

## Fixes

- **Cloud regression fix**: add 300ms debounce on temperature set commands — HomeKit fires both HeatingThreshold and CoolingThreshold handlers for the same gesture, causing duplicate commands that could reset device state
- **LAN poll faster**: default poll interval reduced from 60s to 30s (minimum floor lowered from 30s to 15s)
- **getInfo timeout**: reduced from 3s to 1.5s for faster poll cycles

## v0.0.8-beta.19 - 2026-04-25

## Root Cause Fix: Broadlink Wire Protocol Mode/FanSpeed Translation (LAN only)

The Broadlink LAN wire protocol uses **different numeric values** for AC mode and fan speed than the AUX cloud API. This caused:

- Physical remote HEAT → device reports wire `4` → our code read it as `AuxAcModeValue.AUTO(4)` → HomeKit showed **AUTO** instead of **HEAT**
- Fan AUTO (wire `5`) → our code read it as `AuxFanSpeed.MUTE(5)` → fan speed displayed as MUTE

### Wire protocol (Broadlink reference):
| Concept | Wire value |
|---------|-----------|
| Mode: auto | 0 |
| Mode: cooling | 1 |
| Mode: dry | 2 |
| Mode: heating | 4 |
| Mode: fan | 6 |
| Fan: high | 1 |
| Fan: medium | 2 |
| Fan: low | 3 |
| Fan: turbo | 4 |
| Fan: auto | 5 |

### What changed
- `Protocol.ts`: Corrected `BroadlinkMode` and `BroadlinkFanSpeed` enum values to match wire protocol
- `Protocol.ts`: Added translation functions (`auxModeToBroadlinkWire`, `broadlinkWireToAuxMode`, fan equivalents)
- `Protocol.ts`: `buildCommandPayload` now translates AUX API values → wire values before encoding
- `Protocol.ts`: `AuxFanSpeed.MUTE(5)` now correctly sets the wire mute bit instead of fanspeed byte
- `AuxDeviceControl.parseDecryptedState`: Wire values → AUX API values on read
- **Cloud path is unchanged** — only the LAN code path is affected

### Also in this release (from beta.18)
- Removed unused `applyFanLevel` private method
- Replaced deprecated `sendDeviceParams` calls with `sendDeviceParamsWithRetry`
- Added `mode=X fan=X` to the `State OK` log line for easier diagnostics

## v0.0.8-beta.18 - 2026-04-25

## Fixes

### TypeScript cleanup
- Removed unused `applyFanLevel` private method (was causing TS unused-variable warning)
- Replaced all deprecated `sendDeviceParams()` calls with `sendDeviceParamsWithRetry()` in `setAuxMode` path

### Diagnostic logging (LAN)
- `State OK` log line now includes `mode=X fan=X` to expose raw `ac_mode` and `ac_mark` wire values returned by the device — needed to diagnose mode display bug when physical remote is used

### No behaviour changes to cloud path
All changes are scoped to the LAN code path; cloud control is unchanged.

## v0.0.8-beta.17 - 2026-04-25

## Fixes

### Bug 1: Ambient temperature not shown in HomeKit
- `pollLocalState` now sends a `getInfo` packet after `getState`, receives the 48-byte ambient temperature response, and stores it as `envtemp` in device params.
- `CurrentTemperature` in HomeKit now shows the actual room temperature instead of the hardcoded 24°C default.

### Bug 2 & 3: Fan speed erratic / mode erratic
- `handleRotationSpeedGet` now returns the minimum slider value when `ac_mark === AuxFanSpeed.AUTO`, preventing the slider from displaying 20% (MUTE) when the device is in AUTO fan mode.
- This stopped unintentional MUTE commands being sent when the user moved the fan speed slider while the device was in AUTO fan mode.
- Added `parseDecryptedInfo` helper for clean 48-byte response parsing.

## v0.0.8-beta.16 - 2026-04-25

## Fix: SET commands ahora funcionan — CRC del payload AC era incorrecto

El protocolo usa **dos algoritmos de checksum distintos**:
- Checksums de cabecera Broadlink (`0x20` y `0x34`): byte-sum desde `0xbeaf` — correcto desde beta.15
- **CRC del payload AC** (`request_payload[length+2, length+3]`): Internet checksum (16-bit ones complement) — **era incorrecto, corregido en esta versión**

El GET state funcionaba porque sus magic bytes tienen el CRC precomputado correcto hardcodeado. Los comandos SET fallaban silenciosamente porque el CRC se calculaba dinámicamente con el algoritmo incorrecto.

### Verificado manualmente
- Martin (192.168.20.180): `pwr=1` ✅ tras SET command
- Sala (192.168.20.155): `pwr=1` ✅ tras SET command

### También incluye
- `src/test-lan.ts`: script standalone de prueba de comunicación LAN (auth → SET → GET → assert)

## v0.0.8-beta.15 - 2026-04-25

## Fix: tres regresiones en el protocolo Broadlink LAN

Corrige tres bugs introducidos en beta.13 que causaban que los dispositivos descartaran silenciosamente todos los comandos:

- **`calculateChecksum` incorrecto** — revertido a byte-sum desde `0xbeaf` sin XOR. El firmware del dispositivo espera `sum = 0xbeaf; for each byte: sum += byte; sum &= 0xffff`.
- **Inner checksum eliminado** — restaurado el checksum del payload en claro en `header[0x34-0x35]` antes de encriptar.
- **`cipher.final()` espurio** — eliminado; usamos solo `cipher.update()` para evitar el bloque de padding PKCS#7 que corrompe el payload encriptado.

## v0.0.8-beta.14 - 2026-04-25

Fix outer checksum algorithm (big-endian word sum with carry fold) and add LAN session retry with re-auth on failure.

## Changes
- **Critical**: Outer checksum in `buildPacket` was using `packet[i]` (even-indexed bytes only) instead of big-endian word sum `((packet[i] << 8) + packet[i+1])` with carry fold and ones complement
  - Packets were sent with checksum 0x0000 — devices silently discarded all commands
- Remove periodic re-auth (`scheduleReauth`): devices drop idle sessions, keep-alive is naturally maintained by state polling
- Add `LAN_RECONNECT_RETRY` (2 retries) with re-auth on failure in `sendLocalCommand` and `pollLocalState`
- Socket send now uses callback with error handling — marks session as unauthenticated on error
- Remove inner payload checksum (not used by device, only outer matters)

## v0.0.7-beta.13 — Fix checksum Broadlink (big-endian word sum) - 2026-04-24

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/v0.0.7-beta.12...v0.0.7-beta.13

## v0.0.7-beta.13 - 2026-04-24

fix: correct Broadlink LAN checksum — big-endian word sum instead of byte sum

- Root cause: `calculateChecksum` was summing bytes individually (`sum + data[i]`) instead of 16-bit big-endian words (`sum + ((data[i] << 8) + data[i+1])`)
- This produced invalid checksums (e.g. 0xfc47 vs 0x66de in reference) causing the device to silently discard all command packets
- Fix matches the `broadlink-aircon-api` reference implementation exactly
- Auth and state polling use separate payloads unaffected by this bug

## v0.0.7-beta.12 - 2026-04-24

fix: correct command payload byte 12 — device was silently discarding all LAN commands

- Root cause: `payload[12]` was missing required marker `0x0F` (bits 0-3) present in the reference broadlink-aircon-api implementation
- Without `0x0F` the device validates and discards the command packet without responding or acting on it
- Fix: `payload[12] = 0x0f | (hasHalfDegree ? 0x80 : 0x00)` — matches reference exactly
- Auth and state polling were unaffected because they use separate fixed magic payloads

## v0.0.7-beta.11 - 2026-04-24

fix: LAN commands carry full device state to prevent unintended power-off

- Fix: `sendCommand` for LAN devices now merges `device.params` (current AC state) with the incoming partial params before calling `buildCommandPayload`
- Root cause: `buildCommandPayload` defaults `pwr` to 0 when not included in params; sending `{ac_mode:0}` alone would turn the device off immediately after turning it on
- Commands now match the reference implementation behavior: always send the complete AC state with only the changed param overridden

## v0.0.7-beta.10 - 2026-04-24

fix: visible LAN diagnostic logs and LAN-only device state

- Change critical LAN logs from `debug` to `warn`/`info` so they appear in production without debug mode
- Fix `getLanOnlyDevices`: devices now initialized with `state: 1` so they don't appear "No Response" in HomeKit
- Logs now surface: auth OK/timeout/fail, state poll OK/timeout, command sent, and local poll results
# Changelog

## v0.0.7-beta.9 - 2026-04-24

fix: replace per-call UDP sockets with persistent LAN session per device to fix auth timeout

- Refactor LAN control to use a single persistent UDP socket per device (keyed by MAC)
- Auth happens once at session creation; session key is reused for all subsequent packets
- State responses queued and dispatched to first waiting resolver
- Auth timeout increased from 3s to 5s for reliability
- sendLocalCommand no longer creates/closes sockets per command

## v0.0.7-beta.8 - 2026-04-24

fix: LAN commands fire-and-forget and cloud commands use authenticated client

- Fix `sendLocalCommand`: remove wait for 0xee after control commands — device does not send a response to set commands (was causing all LAN commands to timeout)
- Fix `sendLocalCommand`: convert temperature from ×10 format (e.g. 240) to raw degrees (24) before encoding for LAN protocol
- Fix cloud commands: `AuxDeviceControl` now shares the platform's authenticated `AuxCloudClient` instead of creating its own unauthenticated instance — cloud commands for Aire Dormitorio and other cloud devices now use a valid session

## v0.0.7-beta.7 - 2026-04-24

fix: correct Broadlink LAN protocol — IV, packet encryption, device key exchange

- Fix DEFAULT_IV byte 3: was `0x09`, must be `0x99` (matches broadlink-aircon-api reference)
- Fix `buildPacket`: encrypt payload with AES-128-CBC before sending (device ignored unencrypted packets)
- Fix `buildPacket`: add required header bytes 0x24-0x25 and inner checksum at 0x34-0x35
- Fix auth flow: extract device-specific key+ID from 0xe9 auth response; use device key for all subsequent packets
- Fix `buildAuthPayload`: extend 0x31 range to 0x04–0x12 and correct auth string "Test  1"
- Refactor LAN methods to use native `dgram` socket directly (cleaner, no DgramAsPromised wrapper needed)

## v0.0.7-beta.6 - 2026-04-24

fix: fix LAN two-step auth, double-wrap bug, and cloud device caching

- Fix `pollLocalState`: register UDP listeners before sending packets to fix race condition
- Fix `pollLocalState`: implement two-step auth flow (wait for 0xe9 before sending state query)
- Fix `sendLocalCommand`: use `Protocol.buildCommandPayload` directly to eliminate double-wrapping bug
- Fix `sendLocalCommand`: implement two-step auth flow for commands as well
- Cache last known cloud devices so they don't disappear as "stale" when cloud is unreachable
- Extract `buildAuthPayload()` helper to eliminate code duplication between poll and command paths

## v0.0.7-beta.5 - 2026-04-24

fix: cloud failure no longer blocks LAN-only devices

- Separate cloud fetch from LAN polling in `refreshDevices` — if AUX Cloud login/fetch fails, LAN-only devices are still polled and reconciled independently
- LAN-only devices now update state and appear in HomeKit even when cloud is unreachable

## v0.0.7-beta.4 - 2026-04-24

fix: LAN state polling and feature accessories for LAN-only devices

- Fix `pollLocalState`: response length check was `=== 48` but real Broadlink response is 88 bytes (0x38 header + 32-byte encrypted payload) — state was never read
- Fix `pollLocalState`: decrypt response with AES-128-CBC before parsing state bytes
- Fix `pollLocalState`: multiply temperature by ×10 to match AUX Cloud param format used by the rest of the plugin
- Fix `buildCommandPayload`: convert temp from ×10 format back to raw degrees before encoding for LAN protocol
- Initialize LAN-only devices with default params (fan speed, mode, switches at 0) so all accessories (fan slider, Auto Fan, Health, Clean, Sleep, Screen Display, Mildew Proof) appear in HomeKit immediately before first LAN poll

## v0.0.7-beta.3 - 2026-04-24

fix: LAN discovery no longer fatal when static IPs are configured

- If UDP broadcast discovery finds 0 devices but devices have static `ip` configured, log a warning and continue (don't throw)
- Fatal error only when both discovery fails AND no static IP/MAC fallback is configured
- Fixes startup failure in Docker environments where broadcast UDP is blocked by the network bridge
- Add `ip` field to LAN-only device entries (recommended for Docker/VLAN setups)

## v0.0.7-beta.2 - 2026-04-24

feat: LAN-only devices (mac + name, no endpointId), MAC-based mapping, mandatory discovery

- LAN-only devices create synthetic HomeKit accessories, controlled 100% via LAN UDP
- Discovery mandatory with localControlEnabled: explicit error if no devices found
- Cloud fallback after 3 consecutive LAN failures (not immediate)
- controlStrategy 'local' never attempts cloud
- Add name field to device config

## v0.0.7-beta.2 - 2026-04-23

feat: LAN-only devices, MAC-based mapping, mandatory discovery

- Support devices without AUX Cloud account (`mac` + `name` only, no `endpointId`)
  - Plugin creates synthetic HomeKit accessories controlled 100% via LAN UDP
  - LAN-only devices never attempt cloud fallback
- Change device mapping index from `endpointId` to `mac` (MAC is the stable identifier)
- Discovery is now mandatory when `localControlEnabled: true` — explicit error if no devices found
- Cloud fallback triggers after exactly 3 consecutive LAN failures (was immediate)
- `controlStrategy: "local"` devices throw immediately on LAN failure, no silent cloud retry
- Add `name` field to device config entries (required for LAN-only devices)
- Update README with LAN-only device guide, device type table, and production config example
- Update `config.schema.json` with `name` field and improved descriptions

## v0.0.7-beta.1 - 2026-04-24

feat: local LAN control with cloud fallback

- Add `local-first` / `cloud-only` control strategy for Broadlink-based AUX devices (AC Freedom, etc.)
- Implement Broadlink LAN protocol (UDP) with AES-128-CBC encryption
- Add `dgram-as-promised` dependency for UDP socket management
- Auto-discover Broadlink devices on LAN via UDP broadcast at startup
- Per-device `controlStrategy` override (force `local` or `cloud` per device)
- Local polling for devices with known IP/MAC in refresh loop
- Cloud fallback after 3 consecutive LAN failures
- Update README with LAN control config docs and acknowledgements

**Note:** Local LAN control requires devices running older Broadlink-based firmware. Newer firmware may use a different protocol.

## v0.0.6-beta.1 - 2026-04-21

feat: optimistic UI + configurable retry

**Note:** This plugin currently supports **cloud-only control**. All commands are sent through the AUX Cloud API. There is no local LAN control option — this is planned for a future release.

## 0.0.5 - 2025-12-06

- Add Homebridge verified badge and funding metadata/donation links for AUX Cloud so the plugin appears trusted alongside the new support info.

## 0.0.4 - 2025-11-03

- Expand npm keywords so the Homebridge verification bot can classify the plugin correctly.

## 0.0.3 - 2025-11-03

- Prevent the platform from initializing until AUX Cloud credentials are configured so Homebridge keeps running after fresh installs.

## 0.0.2 - 2025-10-28

## What's Changed
- Ensure AUX mode changes wait for AUX Cloud confirmation and retry automatically so HomeKit stays in sync
- Handle power-on and mode commands separately to avoid falling back to Auto when resuming from Off
- Refresh cached device state more quickly after parameter writes
- Require Node.js 20+ and Homebridge 1.7+ to match the supported LTS releases
- Harden the release workflow and dependency stack for long-term support

**Full Changelog**: https://github.com/fparrav/homebridge-homebridge-aux-cloud/compare/0.0.2-beta.26...0.0.2

## 0.0.2 - 2025-10-27

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.1...0.0.2

- Ensure AUX mode changes wait for cloud confirmation and retry automatically so HomeKit stays in sync.
- Handle power-on and mode commands separately to avoid falling back to Auto.
- Refresh cached device state more quickly after writes to surface confirmed updates in HomeKit.
- Require Node.js 20+ and Homebridge 1.7+ to match supported LTS releases.
- Harden the release workflow and dependency stack for long-term support.

## 0.0.2-beta.15 - 2025-10-27

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.14...0.0.2-beta.15

- Pin semantic-release packages to Node.js 20-compatible versions to restore the release workflow.

## 0.0.2-beta.14 - 2025-10-27

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.13...0.0.2-beta.14

- Fix the release workflow by targeting Node.js 20.19 and pinning semantic-release packages for compatibility.

## 0.0.2-beta.13 - 2025-10-27

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.12...0.0.2-beta.13

- Prevent the device from falling back to Auto when starting Heating from Off by powering on before updating the target mode.

## 0.0.2-beta.12 - 2025-10-24

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.11...0.0.2-beta.12

- Align accessory power detection with AUX Cloud power state so HomeKit shows inactive when the unit is off.
- Report ambient temperature using 0.1° precision instead of rounding to whole degrees.
- Keep heater/cooler mode in sync by updating both `ac_mode` and the auxiliary `mode` flag while powering the unit on when switching targets.
- Expose an “Auto Fan” switch and reserve the fan-speed slider for manual speeds so selecting 0% no longer powers the device off.
- Replace the Homebridge polling interval slider with a numeric input field.
- Stop publishing the redundant child-lock control that HomeKit already shows as a built-in property.
- Fold the “Comfortable Wind” setting into the fan-speed slider (0% = Comfortable, 20–100% = Mute→Turbo) without powering the unit off.
- Add dedicated Dry Mode and Fan Mode switches that are mutually exclusive and fall back to Auto when both are off.

## 0.0.2-beta.10 - 2025-10-24

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.9...0.0.2-beta.10

## 0.0.1
- Initial project scaffold generated from the Homebridge plugin template.
