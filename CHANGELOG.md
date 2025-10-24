# Changelog

## 0.0.2-beta.10 - 2025-10-24

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.9...0.0.2-beta.10

## Unreleased
- Align accessory power detection with AUX Cloud power state so HomeKit shows inactive when the unit is off.
- Report ambient temperature using 0.1° precision instead of rounding to whole degrees.
- Keep heater/cooler mode in sync by updating both `ac_mode` and the auxiliary `mode` flag while powering the unit on when switching targets.
- Expose an “Auto Fan” switch and reserve the fan-speed slider for manual speeds so selecting 0% no longer powers the device off.
- Replace the Homebridge polling interval slider with a numeric input field.
- Stop publishing the redundant child-lock control that HomeKit already shows as a built-in property.

## 0.0.1
- Initial project scaffold generated from the Homebridge plugin template.
