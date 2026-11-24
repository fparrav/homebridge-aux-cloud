## 1. Registro de overrides

- [x] 1.1 Crear `src/forcedFeatures.ts` con `ForcedFeatureRegistry`: parsea `forceMildewProof`, `forceClean` y `forceScreenDisplay` de `config.devices`, indexando por `endpointId` y por `mac` normalizado.
- [x] 1.2 Definir en `src/types.ts` `ScreenDisplayForceMode` (`none` | `forceOn` | `forceOff`), `ForcedFeatureFlags` y las tres opciones en `AuxCloudPlatformConfig.devices`; agregar `getForcedFeatures` a `IAuxCloudPlatform`.
- [x] 1.3 Instanciar el registro en `AuxCloudHAPPlatform`, `AuxCloudMatterPlatform` y `AuxCloudPlatform` (legacy), y exponer `getForcedFeatures(endpointId, mac)`.

## 2. Aplicación del override en los comandos

- [x] 2.1 `ForcedFeatureRegistry.apply(device, params)` inyecta `mldprf: 1` y `ac_clean: 1` solo cuando `params[AC_POWER] === 0`.
- [x] 2.2 `apply` fija `scrdisp` a 1 o 0 en todos los comandos cuando el modo no es `none`.
- [x] 2.3 Ignorar el parámetro y avisar una sola vez por `(endpointId, param)` cuando el dispositivo no lo reporta.
- [x] 2.4 Llamar `this.forcedFeatures.apply(device, params)` antes de `deviceControl.sendCommand` en las tres plataformas.

## 3. Accesorios HAP y Matter

- [x] 3.1 `AuxCloudPlatformAccessory`: leer el override del platform, exponer el switch cuando el dispositivo lo soporta o tiene override, reportar el valor forzado en `get` e ignorar (con warning) las peticiones contrarias en `set`.
- [x] 3.2 `MatterThermostatAccessory`: registrar los switches con override aunque no estén en `featureSwitches`, devolver el valor forzado en `getSwitchState` y reescribir el payload en `handleSwitchSet` cuando la petición contradice el override.

## 4. Configuración y documentación

- [x] 4.1 `config.schema.json`: agregar `forceMildewProof`, `forceClean` y `forceScreenDisplay` (con `enum`) a cada entrada de `devices[]`.
- [x] 4.2 `README.md`: documentar las opciones, la nota de identificación por `endpointId` o `mac`, y la tabla tri-state de `forceScreenDisplay`.

## 5. Tests

- [x] 5.1 Crear `src/__tests__/forcedFeatures.test.ts` con `AuxCloudHAPPlatform` real y un `FakeProvider` para capturar los payloads enviados.
- [x] 5.2 Tests de plataforma: match por endpoint y por MAC, inyección en apagado, no inyección en comandos que no apagan, `scrdisp` en todos los comandos, `forceOn` sobre una petición Off, dispositivo sin override, warning único por parámetro no soportado.
- [x] 5.3 Tests de accessory HAP: switch expuesto y reportado como forzado, petición Off ignorada, pantalla `forceOff`/`forceOn`, y ausencia de switch cuando no hay override.
- [x] 5.4 Tests de accessory Matter: switches registrados con el valor forzado, payload forzado ante petición Off, y ausencia de switches sin override.
- [x] 5.5 Ejecutar `npm run build`, `npm run lint` y `npm test` sin regresiones.
