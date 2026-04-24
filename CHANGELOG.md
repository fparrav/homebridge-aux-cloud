# Changelog

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
