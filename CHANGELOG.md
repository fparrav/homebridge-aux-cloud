# Changelog

## v0.0.12 - 2026-06-28

## What's new in v0.0.12

### feat(platform): `expose` mode — HAP + Matter simultaneously

New `expose` config field replaces the `enableMatter` boolean:

- `expose: "hap"` — HomeKit via HAP only (default)
- `expose: "matter"` — Matter only, replaces HAP accessories  
- `expose: "both"` — HAP for Apple Home **+** Matter for Alexa/Google simultaneously

`enableMatter: true` is preserved as a backward-compatible alias.

### Bug fixes

- **fix(lan)**: `ac_hdir` was parsed from the wrong byte (12 instead of 13), causing horizontal swing to mirror vertical swing after every LAN poll
- **fix(hap)**: swing mode constants were inverted — AUX AC protocol uses `0` = swing active, `1` = fixed
- **fix(hap)**: illegal value warnings on first HeaterCooler creation (default values violated configured `minValue`)
- **fix(matter)**: pending guard missing in `sendCommand()` — poll overwrote optimistic state
- **fix(matter)**: `clusters.onOff` in Thermostat caused wrong icon and "switch" classification in Apple Home
- **fix(matter)**: `fanControl` cluster was not registered in `toAccessory()`
- **fix(matter)**: stale Matter persistence caused "accessory not found" errors after rollback

## v0.0.12 - 2026-06-27

### feat(platform): add `expose` mode — run HAP + Matter simultaneously

New `expose` configuration field replacing the `enableMatter` boolean:

- `expose: "hap"` — HomeKit via HAP only (default)
- `expose: "matter"` — Matter only, replaces HAP accessories
- `expose: "both"` — HAP for Apple Home + Matter for Alexa/Google simultaneously

`enableMatter: true` is preserved as a backward-compatible alias for `expose: "matter"`.

### fix(lan): correct horizontal swing direction byte in LAN state response

`ac_hdir` was incorrectly parsed from byte 12 (same as `ac_vdir`). Fixed to byte 13, bits 7–5.

### fix(hap): inverted swing mode constants

AUX AC protocol uses reversed convention: `ac_vdir/hdir = 0` → swing ACTIVE. `ON/OFF` constants were swapped for both axes.

### fix(hap): illegal value warnings on first accessory creation

HeaterCooler default values (HeatingThreshold=0, RotationSpeed=0) violated configured `minValue`. Fixed with `updateValue()` after `setProps()`.

### fix(matter): pending guard missing in Matter sendCommand

`sendCommand()` did not register the pending guard, allowing poll to overwrite optimistic state. Fixed to match the HAP pattern.

### fix(matter): wrong device type caused "switch" icon in Apple Home

`clusters.onOff` in `deviceTypes.Thermostat` inverted the hierarchy. Removed; power now via `systemMode=0`.

### fix(matter): fanControl cluster missing from Matter accessory

Handlers existed but `fanControl` cluster was not registered in `toAccessory()`. Fixed with `fanModeSequence=0`.

### fix(matter): stale Matter persistence caused "accessory not found" on refresh

On identity conflict, unregister + re-register fresh to clear corrupted persistence from failed transactions.

---

## v0.0.12-beta.54 - 2026-06-27

### feat(platform): add `expose` mode — run HAP + Matter simultaneously

New `expose` configuration field replaces the `enableMatter` boolean:

- `expose: "hap"` — HomeKit via HAP only (default, same as before)
- `expose: "matter"` — Matter only, replaces HAP accessories
- `expose: "both"` — HAP for Apple Home + Matter for Alexa/Google simultaneously

In `expose: "both"` mode the proxy instantiates both platforms concurrently.
HAP receives cached accessories and drives all `configureAccessory` calls; the
Matter platform starts independently without unregistering HAP accessories.
Matter initialization errors are caught so HAP remains active on failure.

The `enableMatter: true` boolean is preserved as a backward-compatible alias for
`expose: "matter"`.

## v0.0.12-beta.53 - 2026-06-27

### fix(lan): correct horizontal swing direction byte in LAN state response

The `ac_hdir` (horizontal swing direction) field was incorrectly parsed from
byte 12 of the decrypted state response — the same byte as `ac_vdir` (vertical
swing). The correct source is byte 13, bits 7–5, matching the SET command format
where horizontal fixation is placed at `payload[11] = (hdir & 0x07) << 5`.

This caused horizontal swing control to mirror the vertical swing value after
every LAN state poll.

### docs: expand commandRetryCount / commandTimeoutMs documentation

Added an explanation of the pending guard formula:
`commandTimeoutMs × (commandRetryCount + 1) + 3000 ms` (18 s with defaults).
Clarified that these parameters apply only to cloud commands. Updated descriptions
in the configuration table.

## v0.0.12-beta.52 - 2026-06-06

### fix(hap): inverted swing mode in HAP — AUX AC protocol convention reversed

The AUX AC protocol uses a **reversed** convention for swing direction parameters:
`ac_vdir/hdir = 0` → swing ACTIVE (oscillating), `1` → swing FIXED.
The `ON/OFF` constants were swapped for both vertical and horizontal axes.

- `constants.ts`: corrected ON=0, OFF=1 for vertical and horizontal
- `platformAccessory.ts`: fixed GET handler (`=== 0` instead of `=== 1`)
- `platformAccessory.ts`: fixed optimistic state in SET handler (`enabled ? 0 : 1`)

**Matter note**: No swing implementation exists in Matter. The `fanControl` cluster only exposes `fanMode`, `fanModeSequence`, `percentSetting`, `percentCurrent`.

## v0.0.12-beta.51 - 2026-05-25

### fix(hap): eliminar warnings 'illegal value' en HeaterCooler al inicializar

Al crear un accesorio HeaterCooler por primera vez, los valores HAP por defecto (HeatingThreshold=0, CoolingThreshold=10, RotationSpeed=0) violan los `minValue` configurados por el plugin (16°C y 20% respectivamente). Corregido con `updateValue()` justo después de `setProps()`.

## v0.0.12-beta.50 - 2026-05-25

## fix: incluir código de modo mixto Matter+HAP (faltó en beta.49)

Beta.49 fue publicada sin el código real — solo contenía el CHANGELOG. Esta release incluye los cambios correctos:

- `Platform.Proxy.ts`: detecta dispositivos con `bridge: 'HAP'` → lanza ambas plataformas en paralelo
- `Platform.HAP.ts`: parámetro `hapOnlyMode` para filtrar solo dispositivos HAP en modo mixto
- `Platform.Matter.ts`: omite desregistro de accessories HAP en modo mixto

## v0.0.12-beta.49 - 2026-05-25

## feat(proxy): modo mixto Matter+HAP — soporte por dispositivo via bridge:'HAP'

Cuando `enableMatter: true` está activo globalmente pero un dispositivo tiene `bridge: 'HAP'` en su config, el dispositivo ahora aparece correctamente en HomeKit vía HAP en lugar de desaparecer.

**Causa raíz**: El `AuxCloudPlatformProxy` usaba selección binaria de plataforma — solo Matter o solo HAP. Los dispositivos con `bridge: 'HAP'` eran ignorados por Matter y HAP nunca se iniciaba.

**Cambios**:
- `Platform.Proxy.ts`: cuando hay dispositivos con `bridge: 'HAP'`, instancia ambas plataformas en paralelo (Matter + HAP con `hapOnlyMode: true`)
- `Platform.HAP.ts`: nuevo parámetro `hapOnlyMode` — solo procesa dispositivos con `bridge: 'HAP'`; los accessories de dispositivos Matter se limpian como stale automáticamente
- `Platform.Matter.ts`: en modo mixto, omite el desregistro de accessories HAP cacheados — la plataforma HAP lo gestiona

## v0.0.12-beta.48 - 2026-05-25

### fix(matter): temperatura muestra 0.0°C — push de estado inicial tras registro

`localTemperature` se mantenía en null/0.0°C hasta el primer ciclo de poll (30s) porque Matter carga el estado persistido al reiniciar y `externalMeasuredIndoorTemperature$Changed` no se disparaba durante la inicialización si el valor persistido era null.

**Fix**: `refreshMatterState()` se llama inmediatamente al finalizar el registro de accesorios en `discoverAndRegisterDevices()`. Esto dispara `updateAccessoryState({externalMeasuredIndoorTemperature: X})` → evento `$Changed` → `#handleMeasuredTemperatureChange` → `localTemperature` actualizado antes de que Apple Home consulte el termostato.

**Modos en Apple Home**: Apple Home solo renderiza Off/Auto/Cool/Heat. Los modos Dry (8) y Fan Only (7) existen en la spec Matter pero no se muestran en la UI de Apple Home — es una limitación del Home app, no del plugin.

**Pasos de temperatura**: Los pasos de 0.5°C son el comportamiento estándar de Apple Home para termostatos Matter. Se puede cambiar a 1°C con `temperatureStep: 1` en la config del plugin.

## v0.0.12-beta.47 - 2026-05-25

### fix(matter): THERMOSTAT_MODE_DRY corregido (6→8), doble comando en fan y setpoints eliminado

- **DRY mode**: `THERMOSTAT_MODE_DRY` corregido de `6` (Precooling) a `8` (Dry) según Matter Spec § 9.1. El valor 6 era Precooling — un modo distinto al Dry del AC.
- **Doble comando en fan**: `handlePercentSettingChange` enviaba dos comandos al detectar transición on/off. Simplificado a un único comando: `0%→MUTE`, `1-25%→LOW`, `26-50%→MEDIUM`, `51-75%→HIGH`, `76-100%→TURBO`.
- **Doble comando en setpoints**: `handleHeatingSetpointChange` y `handleCoolingSetpointChange` enviaban `AUX_MODE` por separado, lo que podía mezclar `pwr=0` stale del estado del dispositivo. Eliminado — el modo lo controla exclusivamente `handleSystemModeChange`.

## v0.0.12-beta.46 - 2026-05-25

## fix(matter): thermostat falla al registrar — presetTypes constraint "1 to 7"

La versión de Matter.js en uso declara `presetTypes` como atributo obligatorio del cluster Thermostat con constraint `"1 to 7"` (el array debe tener entre 1 y 7 elementos). Al eliminarlo en beta.44, Matter.js inicializaba el atributo con `[]` (longitud 0), lo que fallaba la validación en el momento del registro e impedía que el termostato se cargara. Devuelto con un preset válido mínimo: `[{ presetScenario: 1, numberOfPresets: 1, presetTypeFeatures: {} }]`.

## v0.0.12-beta.45 - 2026-05-25

## feat(matter): exposer fan como accesorio Fan (§ 9.2) independiente con slider de velocidad

- `fanControl` movido desde el cluster del Thermostat a un nuevo método `toFanAccessory()` que crea un accesorio de tipo `Fan` (Matter § 9.2). En Apple Home aparece como un tile dedicado con slider de velocidad de ventilador (porcentaje) y selector de modo (Off/Low/Medium/High).
- El accesorio Fan se registra en `Platform.Matter.ts` como accesorio independiente junto al Thermostat y los feature switches. UUID estable: `matter-fan-<endpointId>`.
- `refresh()` actualiza el Fan por su propio UUID (`matter-fan-*`) en lugar del UUID del thermostat.
- Los handlers `fanModeChange` y `percentSettingChange` permanecen iguales — solo cambia el accesorio al que están asociados.
- Tests actualizados: `fanControl` verificado en `toFanAccessory()` y confirmado ausente en `toAccessory()`.

## v0.0.12-beta.44 - 2026-05-25

## fix(matter): thermostatRunningMode crash, ícono switch, regresión externalMeasuredIndoorTemperature

- **Crash en cada poll**: `thermostatRunningMode` usaba valores `0x01` (Heating) y `0x08` (Cooling) que no existen en el enum Matter (válidos: 0, 3, 4). Causa: rollback en cada actualización de estado → la temperatura y el modo nunca se actualizaban. Solución: eliminado `thermostatRunningMode` del cluster (la wiki de homebridge-matter no lo lista como atributo soportado).
- **Regresión de temperatura (beta.43)**: Se había cambiado `externalMeasuredIndoorTemperature` → `localTemperature` incorrectamente. La wiki dice explícitamente "use externalMeasuredIndoorTemperature instead of localTemperature" y que auto-popula `localTemperature`. Revertido.
- **Ícono switch en Apple Home**: Los `OnOffSwitch` registrados como `parts` del Thermostat hacían que Apple Home clasificara el dispositivo en "Otro" (switch) en lugar de "Clima/HVAC". Solución: los feature switches ahora se registran como accesorios Matter independientes; el thermostat queda solo como `Thermostat` device type.
- Eliminados atributos no estándar `presetTypes`, `numberOfPresets`, `activePresetHandle` que podían causar errores de validación.

## v0.0.12-beta.43 - 2026-05-25

## fix(matter): usar localTemperature para temperatura actual; corregir apagado tras cambio de modo

- **Bug temperatura 0°C**: `externalMeasuredIndoorTemperature` no es el atributo que Apple Home muestra como temperatura actual — Apple Home muestra `localTemperature`. Reemplazado en el estado inicial (`toAccessory()`) y en actualizaciones de poll (`refresh()`). El valor `envtemp` del protocolo LAN (e.g. 18°C) ahora se refleja correctamente en la UI.
- **Bug AC se apaga tras cambio de modo**: `handleSystemModeChange` enviaba dos comandos separados — `AC_POWER_ON` y `{AUX_MODE}`. La ruta LAN hace merge completo con `device.params` (que aún tiene `pwr=0` del último poll), por lo que el segundo comando llegaba con `pwr=0` apagando el AC. Corregido: power-on y cambio de modo se combinan en un solo comando, de modo que `pwr=1` en los params entrantes sobreescribe el `pwr=0` del estado stale.

## v0.0.12-beta.42 - 2026-05-25

## fix(matter): temperatura 0°C cuando AC no ha reportado aún; actualiza CLAUDE.md

- `getMatterCurrentTemp()` ahora trata `AC_TEMPERATURE_AMBIENT = 0` como "no disponible" y retorna `2100` (21°C) como default. El AC reporta 0 cuando el parámetro no ha sido fetched aún; pasarlo literal como `externalMeasuredIndoorTemperature: 0` causaba que Apple Home mostrara 0°C.
- Actualizado `CLAUDE.md`: agrega referencia a wiki oficial de homebridge-matter HVAC, gotchas de `externalMeasuredIndoorTemperature`, re-pairing obligatorio tras cambios de device type, y nota sobre feature switches como parts causando ícono switch en Apple Home.

## v0.0.12-beta.41 - 2026-05-25

## fix(matter): localTemperature read-only, temperatureStep rounding, temperatureStep en IAuxCloudPlatform

- **Bug crítico**: `localTemperature` es de solo lectura en la especificación Matter. Reemplazado por `externalMeasuredIndoorTemperature` en el estado inicial (`toAccessory()`) y en las actualizaciones de poll (`refresh()`). El valor se propaga automáticamente a `localTemperature`. Escribir en un atributo read-only causaba que Apple Home registrara el dispositivo como tipo incorrecto (switch en lugar de termostato/HVAC).
- **Temperature step**: Los handlers `handleHeatingSetpointChange` y `handleCoolingSetpointChange` ahora redondean el setpoint recibido al `temperatureStep` configurado (0.5 o 1°C) antes de enviarlo al AC. Antes ignoraban la configuración y pasaban el valor raw de Apple Home.
- **IAuxCloudPlatform**: Agregado `readonly temperatureStep: number` a la interfaz para que `MatterThermostatAccessory` pueda leer el step sin depender de la implementación concreta del platform.

## v0.0.12-beta.40 - 2026-05-25

## fix(matter): corregir fanModeSequence y etiquetas de feature switches

- `fanModeSequence` corregido de `5` (OffLowMedHighAuto) a `0` (OffLowMedHigh): el valor anterior requería el feature flag `[AUT]` que Homebridge 2.x valida estrictamente, causando potencial error al inicializar el cluster y mostrando el ícono incorrecto (switch) en Apple Home.
- `getMatterFanMode()` actualizado: el valor por defecto pasa de `5` (Auto) a `1` (Low), ya que Auto no está disponible sin el feature flag `[AUT]`.
- `displayName` de los feature switches cambiado de `"<device> - <label>"` a solo `"<label>"` (e.g., "Eco Mode", "Screen Display"): mejora la identificación de los switches agrupados en Apple Home.

## v0.0.12-beta.39 - 2026-05-25

## refactor: reemplazar enableHAP/enableMatter per-device por campo bridge enum

Los campos booleanos `enableHAP` y `enableMatter` por dispositivo eran mutuamente exclusivos pero se presentaban como dos checkboxes independientes, lo cual podía inducir a configuraciones contradictorias. Reemplazados por un único campo `bridge: "HAP" | "Matter"` (default `"HAP"`) que renderiza como select en la UI de Homebridge.

Retrocompatible: dispositivos sin `bridge` definido usan HAP por defecto.

## v0.0.12-beta.38 - 2026-05-25

## fix: agregar peerDependencies para homebridge

`package.json` no declaraba `homebridge` en `peerDependencies`, lo que causaba que npm intentara reorganizar el directorio `homebridge` en `node_modules` durante la instalación del plugin, resultando en errores `ENOTEMPTY`. Agregado `"homebridge": "^1.8.0 || ^2.0.0"` como peer dependency conforme a las convenciones de plugins Homebridge.

## v0.0.12-beta.37 - 2026-05-25

## fix: require('./matter') rompía carga del plugin

La beta.36 fallaba al iniciar porque `import './matter'` en `Platform.Proxy.ts` se compilaba como `require('./matter')` en el JS output, pero `matter.d.ts` no tiene un `.js` correspondiente — causando `Cannot find module './matter'` en runtime.

`matter.d.ts` ya está incluido globalmente en la compilación vía `"src/**/*.ts"` en tsconfig, por lo que no se necesita importarlo explícitamente.

## v0.0.12-beta.36 - 2026-05-25

## refactor: Matter-first con HAP fallback (patrón Roomba)

Separa la plataforma monolítica en clases especializadas con exclusión mutua:

- **`AuxCloudMatterPlatform`** — Matter-first: toma control cuando Matter está disponible y habilitado, elimina accesorios HAP heredados automáticamente
- **`AuxCloudHAPPlatform`** — HAP pura: fallback cuando Matter no está disponible o no está habilitado
- **`AuxCloudPlatformProxy`** — Decide qué plataforma usar en `didFinishLaunching` basándose en `isMatterAvailable()` + `isMatterEnabled()` + `config.enableMatter`
- **`types.ts`** — Tipos compartidos: `AuxCloudPlatformConfig`, `FeatureSwitchKey`, `IAuxCloudPlatform`

### Problemas resueltos
- mDNS conflicts por bridges HAP y Matter simultáneos
- Matter server crash loop cada ~1-2 min
- Competencia de estado entre HAP y Matter

### Migración
No se requieren cambios de config. El comportamiento por defecto es idéntico.  
Para activar Matter: `"enableMatter": true` en la config del plugin.

## v0.0.12-beta.35 - 2026-05-17

fix(lan): close UDP socket on auth failure to prevent event loop overload

Root cause: when doSessionAuth times out (e.g. Dormitorio LAN unreachable), the UDP socket was leaked. After ~9 hours, 1,700+ open sockets caused libuv event loop overload on Raspberry Pi — UDP responses were processed after the 3 s timeout, making all LAN operations fail until restart.

Fixes:
- Close socket immediately on auth failure (primary fix)
- Remove orphaned resolver from stateResolvers on getInfo timeout (secondary)

## v0.0.12-beta.34 - 2026-05-10

## Fix

- **Fix:** Initial fanMode value causing Matter.js conformance error (beta.33 regression)
  - fanMode initial value: Auto (5) → Low (1)
  - fanModeSequence remains 5 (OffLowMedHighAuto) — Auto still exposed to HomeKit
  - Fixes: '[endpoint-behaviors] Behaviors have errors' on accessory registration

## Context

- beta.33 exposed Auto fan speed but broke accessory registration
- Matter.js validates initial fanMode against conformance rules

## v0.0.12-beta.33 - 2026-05-10

## Changes

- **Fix:** Expose Auto fan speed in HomeKit (fanModeSequence 0→5, OffLowMedHighAuto)
- **Fix:** Pending guard in Matter state refresh prevents optimistic state overwrite
- **Fix:** Switch serial numbers include feature label for HomeKit identification
- **Fix:** Matter refresh skips when command is pending (prevents state revert)
- Version bump to 0.0.12-beta.33

## Context

- beta.32 exposed Auto fan speed gap and state revert bug
- Docker Swarm stack on rpi1, Homebridge 2.0.2

## v0.0.12-beta.32 - 2026-05-09

fix(presetTypes): use proper PresetType object instead of plain number 0
fix(thermostatRunningMode): dynamic state tracking in toAccessory() and refresh()
chore: version bump to 0.0.12-beta.32

## v0.0.12-beta.31 - 2026-05-09

Fix Matter spec compliance:
- Agrega presetTypes: [0] para satisfacer constraint 1-7 items de Matter spec
- Sin esto, la librería inicializa como [] y falla la validación del cluster thermostat

## v0.0.12-beta.30 - 2026-05-09

## Matter Registration Fix

- **Fixed behavior initialization error**: Added missing `thermostatRunningMode: 0` to thermostat cluster config. Homebridge Matter server requires this attribute when the AUTO feature is enabled. Without it, accessory registration fails with "[endpoint-behaviors] Behaviors have errors" and accessories are not registered.
- **Removed unused `presetTypes`**: Empty array caused validation errors in Matter spec compliance.

## v0.0.12-beta.29 - 2026-05-09

## Matter Registration Fix

- **Fix race condition**: `registerMatterAccessories()` now awaited inside `initialize().then()`, preventing "Accessory not found or not registered" errors caused by poll cycles starting MatterThermostatAccessory.refresh() before Matter finished registering accessories
- **Capability-based detection**: Replaced broken `api.packageJSON` version parsing with `api.isMatterAvailable()` + `api.isMatterEnabled()` (following homebridge-roomba/august patterns)
- **Dead code removed**: Eliminated `cachedMatterAccessories`, `configureMatterAccessory`, and the unreachable "resume path" in `registerOrResumeAccessories`
- Simplified `registerOrResumeAccessories` → `registerMatterAccessoriesInternal` with single fresh-register path

## Tests

- Rewrote `platform.registerMatter.test.ts` for new single-path behavior (5 tests)

## v0.0.12-beta.28 - 2026-05-07

fix(matter): add presetTypes to thermostat cluster config for PRES feature — deviceTypes.Thermostat enables Preset (PRES) feature by default, making presetTypes a required attribute. Without it, conformance validation fails with [endpoint-behaviors] Behaviors have errors during registration.

## v0.0.12-beta.27 - 2026-05-07

fix(matter): remove updatePlatformAccessories from fresh-register path

updatePlatformAccessories overwrites the internalAccessory (which finalizeAccessoryRegistration stores with a live endpoint) with our plain thermostat object (no endpoint). This caused updateAccessoryState to fail with 'not found or not registered' on every poll cycle. finalizeAccessoryRegistration already correctly populates the accessories Map — no second call needed.

## v0.0.12-beta.26 - 2026-05-07

fix(matter): remove duplicate LAN device registration

Root cause of 'Accessory not found or not registered' errors on every poll cycle.

getLanOnlyDevices() returns objects already in devicesById after reconcileAccessories runs. Including it in registerMatterAccessories caused registerOrResumeAccessories to be called twice for the same UUID — the second call triggered an identity-conflict cascade that corrupted the accessories Map and caused updateAccessoryState to fail.

## v0.0.12-beta.25 - 2026-05-07

## fix(matter): always call updatePlatformAccessories — beta.25

### Diagnóstico confirmado
`registerPlatformAccessories` es fire-and-forget: resuelve inmediatamente aunque Homebridge falle internamente con `identity-conflict`. El `accessories` Map (que usa `updateAccessoryState`) nunca se poblaba en reinicios posteriores.

### Fix
En la ruta non-cached, se llama AMBOS:
1. `registerPlatformAccessories` — maneja primer boot (popula Map y cache)
2. `updatePlatformAccessories` — maneja reinicios (endpoint ya persisted → popula Map con handlers actuales)

El `configureMatterAccessory` se mantiene como optimización para cuando Homebridge lo llame correctamente (evita el `registerPlatformAccessories` innecesario).

### Logs esperados al reiniciar
```
[Aux Cloud] [Matter] "Aire Sala" registered and updated
```
Sin errores `not found or not registered` en el refresh.

## v0.0.12-beta.24 - 2026-05-07

## fix(matter): implement configureMatterAccessory — beta.24

### Root cause
El plugin no implementaba `configureMatterAccessory()`, el callback de Homebridge 2.x que se llama al arrancar para cada endpoint Matter persistido (equivalente a `configureAccessory()` para HAP). Sin este callback, el plugin nunca sabía que el endpoint ya existía en StateManager, siempre intentaba `registerPlatformAccessories` (que fallaba con "already defined"), y los handlers de la sesión actual nunca se re-registraban.

### Fix
- **Añadido `configureMatterAccessory(accessory)`**: almacena el endpoint en `cachedMatterAccessories` Map al arrancar.
- **`registerOrResumeAccessories` actualizado**: si el UUID está en cache → `updatePlatformAccessories` (re-attach de handlers, no toca StateManager); si es nuevo → `registerPlatformAccessories` (primera vez).
- **`MatterAPI` type**: añadido `updatePlatformAccessories` a la declaración de tipos.

### Expected logs on restart
```
[Matter] Restoring cached: Aire Sala (0454966e-...)
[Matter] "Aire Sala" resumed — handlers re-attached
```

## v0.0.12-beta.23 - 2026-05-07

fix(matter): resume existing endpoint on 'already defined' without unregistering

Root cause identified: unregisterPlatformAccessories removes the endpoint from
Homebridge's in-memory StateManager. The subsequent registerPlatformAccessories
cannot re-add it to StateManager at runtime (StateManager is only populated from
persistence at startup).

When 'already defined' is received, the endpoint IS in StateManager (loaded from
persistence at startup). The correct behavior is to treat it as a successful resume
and NOT unregister — doing so destroys the StateManager entry irreversibly until
the next restart.

Added INFO-level logging to confirm which path (fresh register vs. resume) is taken
on startup, aiding future diagnostics.

## v0.0.12-beta.22 - 2026-05-07

fix(matter): always unregister before register to reliably add endpoint to StateManager

The previous unregister+re-register recovery on 'already defined' removed the endpoint
from Homebridge's in-memory StateManager but the subsequent re-registration did not
restore it reliably, causing 'Accessory not found or not registered' on every poll cycle.

New approach: always unregister first (silent catch if not previously registered),
then register fresh. This guarantees StateManager is updated via the normal registration
path rather than the broken recovery path.

## v0.0.12-beta.21 - 2026-05-07

fix(matter): re-register stale Matter endpoint from broken persistence

Causa: tras el rollback del transaction de beta.18, el UUID quedaba en la DB de Matter pero el endpoint no era funcional. Cada poll fallaba con 'Accessory not found or not registered'.

Fix: cuando registerPlatformAccessories lanza 'already defined', se desregistra el endpoint obsoleto y se re-registra fresh.

## v0.0.12-beta.19 - 2026-05-07

## Cambios en v0.0.12-beta.19

### fix(matter): fanModeSequence=0 para evitar error de conformance AUT

**Problema:** El dispositivo no se registraba en Matter con el error:
```
[enum-value-conformance] fanControl.state.fanModeSequence: Conformance "[AUT].b":
Matter does not allow enum value OffLowMedHighAuto (ID 2) here
```

**Causa:** `fanModeSequence=2` (OffLowMedHighAuto) requiere el feature flag `AUT` declarado en el cluster FanControl (Matter Spec § 4.4.6.2). Sin declararlo, Homebridge Matter rechaza el cluster en la inicialización y el dispositivo no se registra.

**Fix:** Se cambió a `fanModeSequence=0` (OffLowMedHigh), que cubre Off/Low/Med/High sin requerir el feature AUT. El fanMode=5 (Auto) tampoco se usa ya que `getMatterFanMode()` nunca retorna 5 sin el feature flag.

### feat: infraestructura de tests (Jest + ts-jest)

- Configuración de Jest con ts-jest para tests TypeScript
- 5 tests unitarios para `MatterThermostatAccessory.toAccessory()`:
  - `fanModeSequence` no usa valores que requieren AUT (2, 3, 4)
  - Cluster `fanControl` presente y handlers conectados
  - Cluster `onOff` ausente del thermostat (power via `systemMode=0`)
  - `systemMode=0` cuando `pwr=0` en el dispositivo

## v0.0.12-beta.18 - 2026-05-07

## Cambios en v0.0.12-beta.18

### fix(matter): fanControl cluster, state overwrite, y jerarquía de dispositivo

**Problema 1 — Estado revertido por el poll**
Los handlers de Matter no registraban el pending guard, por lo que el siguiente ciclo de poll sobreescribía los cambios enviados vía Apple Home o control remoto físico. Ahora `sendCommand()` registra y libera el guard con el mismo patrón que los handlers HAP (`registerPendingCommand` + `setTimeout completePendingCommand`).

**Problema 2 — Dispositivo aparecía como "switch con thermostat"**
El cluster `onOff` en un `deviceTypes.Thermostat` causaba que Homebridge Matter elevara el switch a nivel superior, invirtiendo la jerarquía. Se eliminó el cluster `onOff` del termostato principal. El apagado ahora se maneja vía `systemMode=0` (Matter Spec § 9.1): `getMatterSystemMode()` retorna 0 cuando el AC está apagado, y `handleSystemModeChange()` envía el comando de apagado/encendido según corresponda.

**Problema 3 — Faltaba el cluster fanControl**
`handleFanModeChange` y `handlePercentSettingChange` existían pero no estaban registrados. Se agregó el cluster `fanControl` (con `fanModeSequence=2`: Off/Low/Med/High/Auto) tanto en `toAccessory()` como en `refresh()`, exponiendo los controles de velocidad de fan en Apple Home.

## v0.0.12-beta.17 - 2026-05-06

## Fixes

- **Temperatura actual**: Cambiado a `localTemperature` en el cluster thermostat. Antes se usaba `externalMeasuredIndoorTemperature` que requiere el feature `EXT` habilitado — HomeKit no lo mostraba correctamente.
- **Tipo de dispositivo primario**: Agregado cluster `onOff` al endpoint padre del termostato. Esto hace que HomeKit reconozca el termostato como el dispositivo principal (termostato con switches) en lugar de mostrar los switches como control primario.

## v0.0.12-beta.16 - 2026-05-06

## Mejora: validación de prerequisitos antes de registrar Matter

Al arrancar, el plugin ahora valida explícitamente:

1. **Homebridge v2.0+** — si la versión es anterior, loguea advertencia y omite Matter
2. **Matter disponible** — si Matter no está instalado en Homebridge, loguea advertencia
3. **Matter habilitado** — si Matter está instalado pero desactivado en Settings, loguea advertencia

En vez de fallar silenciosamente o con errores crípticos, el log ahora dice exactamente qué falta configurar.

## v0.0.12-beta.15 - 2026-05-06

fix: campo id requerido en switches como parts del termostato Matter (Homebridge valida part.id)

## v0.0.12-beta.14 - 2026-05-06

fix: soporte Node.js v24 en engines field — el container homebridge/homebridge:latest ahora usa Node 24

## v0.0.12-beta.13 - 2026-05-06

## Breaking fix — requiere reset del estado Matter en Homebridge

Eliminados `fanControl` y `onOff` del cluster del termostato Matter, siguiendo el plugin de referencia (homebridge-matter ThermostatAccessory). Estos clusters causaban errores de conformance por el feature flag `AUT` que la API de plugins de Homebridge no permite declarar.

El termostato Matter ahora solo expone el cluster `thermostat` (setpoints + modo del sistema), con las switches de features como `parts`.

### ⚠️ Paso obligatorio: resetear estado Matter

El estado Matter persistido de betas anteriores tiene `fanModeSequence: 2` en caché, lo que corrompe la inicialización al reiniciar. Antes de actualizar:

**En Homebridge UI → Complementos → Homebridge Matter → Configuración → Restablecer estado Matter**

O equivalente desde la CLI/UI de Homebridge para limpiar el estado Matter persistido. Luego instalar beta.13 y reiniciar Homebridge.

## v0.0.12-beta.12 - 2026-05-06

## Fixes

- **Switches agrupados**: los switches de cada AC (Mildew Proof, Screen Display, etc.) ahora se registran como `parts` del termostato, en vez de como accesorios independientes. Deben aparecer agrupados bajo el mismo dispositivo en la app Home.
- **model/productName**: truncado a 32 chars para satisfacer el constraint de Matter en todos los accesorios.

## v0.0.12-beta.11 - 2026-05-06

## Fixes

- **fanModeSequence**: cambia de `2` (OffLowMedHighAuto) a `0` (OffLowMedHigh). El valor 2 requiere la feature flag `AUT` que no está declarada — mismo constraint que `fanMode=5` de betas anteriores, pero sobre la secuencia.
- **serialNumber**: trunca a 32 caracteres en termostatos y switches. Matter impone un máximo de 32 bytes en este campo.

## v0.0.12-beta.10 - 2026-05-06

## Fixes

- **Switch displayName**: reemplaza el em-dash `—` por hyphen ASCII ` - ` para evitar que la longitud en bytes supere el límite de 32 bytes del campo `productName` de Matter (el em-dash ocupa 3 bytes en UTF-8).
- **Persistencia Matter**: Homebridge persiste el estado Matter entre reinicios. Al reiniciar, los accesorios ya existen en la caché y `registerPlatformAccessories` falla con *"already defined"*. Ahora se registra cada accesorio individualmente y ese error se trata como éxito (el accesorio está disponible), en vez de saltear el dispositivo del ciclo de polling.

## v0.0.12-beta.9 - 2026-05-06

## Fixes

- **fanControl**: Default `fanMode` to `1` (Low) instead of `5` (Auto) — Matter spec rejects Auto when `AUT` feature flag is not declared (included in beta.8).
- **Matter polling**: `registerPlatformAccessories` is now awaited before adding the accessory to the poll list. Previously, a failed registration still added the accessory to the poll cycle, causing `updateAccessoryState: not found or not registered` errors on every poll.

## v0.0.12-beta.8 - 2026-05-06

fix: default fanMode to Low instead of Auto (AUT feature not declared in FanControl cluster)

## v0.0.12-beta.7 - 2026-05-06

## Fix crítico — Matter no registraba dispositivos

**Root cause**: `isMatterAvailable()` y `isMatterEnabled()` son métodos en `HomebridgeAPI` (`api`), NO en `MatterAPIImpl` (`api.matter`). El código buscaba en el lugar equivocado, siempre evaluaba a `false`, y nunca llamaba `registerMatterAccessories()`.

### Cambios
- `src/platform.ts`: Cambia `this.api.matter?.isMatterAvailable()` → `this.api.isMatterAvailable?.()` en los dos lugares donde se verificaba
- `src/matter.d.ts`: Mueve `isMatterAvailable?()` e `isMatterEnabled?()` de `MatterAPI` a `API` para reflejar la API real de Homebridge v2

Este fix es necesario para que los accesorios Matter (termostatos de ACs) aparezcan en Apple Home, Google Home, etc. después de comisionar el hub.

## v0.0.12-beta.6 - 2026-05-06

## Fixes

- **fix: race condition Matter** — `registerMatterAccessories()` ahora corre después de que `initialize()` resuelve, así que `devicesById` está poblado cuando se registran los accesorios Matter. Antes se registraban 0 dispositivos siempre.
- **fix: loop recursivo en refresh()** — `MatterThermostatAccessory.refresh()` ya no llama `refreshDevices()` (que a su vez llamaba `refresh()` de vuelta). Ahora lee el estado con `getDevice()` directamente.

## Nueva feature

- **Per-device HAP/Matter toggles** — cada dispositivo en la lista `devices` de la configuración ahora acepta `enableHAP` (boolean, default `true`) y `enableMatter` (boolean, default `true`) para controlar individualmente si se registra en HomeKit vía HAP, en Matter, o en ambos.

## Upgrade recomendado

Si estás corriendo v0.0.11 con Homebridge v2, actualizá a esta versión. v0.0.11 crashea con `TypeError: this.api.matter?.isMatterAvailable is not a function` al iniciar, lo que impide que HAP y Matter funcionen.

## v0.0.12-beta.5 - 2026-05-05

fix: guard isMatterAvailable correctly (typeof check), fix: push commits to origin before release so CI compiles the right code, feat: add enableHomeKit toggle to config schema UI

## v0.0.12-beta.4 - 2026-05-05

feat: add enableHomeKit toggle to config schema UI

## v0.0.11 - 2026-05-05

Stable release based on v0.0.11-beta.4. HomeKit plugin for AUX Cloud AC devices with LAN and cloud control.

## v0.0.12-beta.3 - 2026-05-05

fix: guard `isMatterAvailable` call para compatibilidad con versiones de Homebridge que no exponen el método. Evita TypeError al arrancar cuando Matter está parcialmente disponible.

## v0.0.12-beta.2 - 2026-05-05

Chore:
- Remove all @typescript-eslint/no-explicit-any casts from MatterThermostatAccessory
- Define MatterAccessoryConfig interface with proper MatterHandlerCallback union type
- Eliminate 4 remaining type assertion casts in refresh() method

Build now passes ESLint and TypeScript with zero errors.

## v0.0.11-beta.4 - 2026-05-04

fix: revert homebridge devDependency to ^1.8.0 so CI yarn install resolves correctly (v2 only declared in engines field)

## v0.0.11-beta.2 - 2026-05-04

feat: support Homebridge v2 in engines field (^1.8.0 || ^2.0.0) to pass v2 readiness check

## v0.0.11-beta.1 - 2026-05-03

## Bug fixes

### Bug 1 — Fan auto y oscilación revertían aleatoriamente en dispositivos LAN
Los handlers `handleRotationSpeedSet`, `handleFanAutoSet` y `handleSwingModeSet` no registraban un *pending guard*, lo que permitía que el ciclo de poll sobreescribiera el estado optimista mientras el comando LAN estaba en vuelo. Ahora se registra el guard con la misma lógica que ya usaba `handleActiveSet`.

### Bug 2 — Comando "apagar" no llegaba al dispositivo cloud
La sesión cloud solo se refrescaba durante el ciclo de poll. Si la sesión expiraba entre polls, los comandos cloud fallaban silenciosamente y el estado de HomeKit revertía al valor real del dispositivo tras ~18–30s. Ahora `sendDeviceParamsWithRetry` llama `ensureLoggedIn` proactivamente antes de cada comando. Además, `startDeviceCommand` dispara un refresh rápido (500ms) ante cualquier fallo para corregir el estado en HomeKit rápidamente en lugar de esperar al siguiente poll.

## v0.0.10 — Fix: cloud mode commands turn AC off after power-on - 2026-04-27

## Bug fix: Cloud mode commands turn AC off after power-on

When turning on a cloud-controlled AC from HomeKit, the device would turn back off seconds later (two audible beeps: power-on, then turn-off from the mode command).

**Root cause:** The cloud command path in `AuxDeviceControl.sendCommand` sent partial parameter sets (e.g. `{ ac_mode: 1 }`) without the current power state (`pwr`). The AUX cloud used its cached `pwr=0` when building the full device packet, sending an implicit power-off alongside the mode change.

The LAN path already merged full device state into every command. This release applies the equivalent fix to the cloud path: `pwr` is now always prepended to cloud commands when absent from the params and available in the local optimistic state.

**Affected:** cloud-only devices (`controlStrategy: "cloud"`). LAN-only devices were not affected.

**Regression since:** v0.0.5 (when concurrent power + mode HomeKit handlers were introduced).

### Changes
- `src/api/AuxDeviceControl.ts`: prepend `pwr` from `device.params` to cloud commands when not already present

## v0.0.10 - 2026-04-26

### Bug fix: Cloud mode/temperature commands turn AC off after power-on

When turning on a cloud-controlled AC from HomeKit, the device would turn back off seconds after turning on (two beeps audible: one for power-on, one for the turn-off caused by the mode command).

**Root cause:** The cloud command path in `AuxDeviceControl.sendCommand` sent partial parameter sets (e.g. `{ ac_mode: 1 }`) without including the current power state (`pwr`). The AUX cloud API used its cached device state — which still showed `pwr=0` — when building the full command packet sent to the AC. The result was an implicit `pwr=0` alongside the mode change, physically turning the device off.

The LAN path already had this fix (merging full device state into every command). This release applies the equivalent fix to the cloud path: `pwr` is now always included in cloud commands when the current optimistic state has it set.

**Fix:** In `AuxDeviceControl.sendCommand`, before calling `sendCloudCommand`, the current `pwr` value from `device.params` is prepended to the params if not already present in the command.

This bug was introduced in v0.0.5 when concurrent HomeKit characteristic handlers began sending separate power and mode commands. It only affects cloud-controlled devices (not LAN-only).

## v0.0.9 - 2026-04-26

Homebridge v2 compatibility: updated engines range to support both v1 and v2.

- homebridge: ^1.6.0 || ^2.0.0-beta.0
- node: ^18.20.4 || ^20.15.1 || ^22

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
