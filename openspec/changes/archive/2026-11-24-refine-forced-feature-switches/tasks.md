## 1. Registro y tipos

- [x] 1.1 `src/types.ts`, `src/platform.ts` (tipos legacy) y `config.schema.json`: quitar `forceClean`/`ForcedFeatureFlags.clean`; agregar `forceHealth?: boolean` y `ForcedFeatureFlags.health: boolean` (solo opción de config).
- [x] 1.2 `src/forcedFeatures.ts`: quitar el manejo de `forceClean`/`AC_CLEAN`; agregar `forceHealth` (inyecta `ac_health: 1` solo si el equipo queda encendido: `params.pwr === 1`, o sin `pwr` en el comando y `device.params.pwr === 1`; nunca con `pwr: 0`; si el dispositivo no reporta `ac_health`, aviso único habitual); exportar `resolveForcedValue(flags, param): boolean | undefined` (solo para `mldprf` y `scrdisp`; Health no se resuelve como switch).

## 2. Accesorios

- [x] 2.1 `src/platformAccessory.ts`: usar `resolveForcedValue` (borrar la copia local); en `handleFeatureSwitchSet`, petición contraria sobre Mildew Proof forzado → aviso, restaurar el switch a On y NO llamar a `startDeviceCommand`; para `scrdisp` forzado → aviso y enviar el valor forzado. No se agrega ningún switch por `forceHealth`.
- [x] 2.2 `src/MatterThermostatAccessory.ts`: mismo cambio con `handleSwitchSet` y `getSwitchState`, usando `resolveForcedValue`.

## 3. Tests y docs

- [x] 3.1 `src/__tests__/forcedFeatures.test.ts`: eliminar los casos de `forceClean`; actualizar los de Mildew Proof (Off ignorado → sin comando) en HAP y Matter; agregar casos de `forceHealth` (se inyecta con el equipo encendido en un cambio de modo o temperatura, no se inyecta con `pwr: 0` ni con el equipo apagado, no se crea ningún switch, modelo sin `ac_health` avisa una vez) y de config heredada con `forceClean`.
- [x] 3.2 `README.md`: quitar `forceClean` de la tabla, la prosa, el ejemplo JSON y la línea de características; documentar `forceHealth` (opción de config, solo con el equipo encendido, sin switch).

## 4. Verificación (coordinador)

- [x] 4.1 `npm run build`, `npm run lint` y `npm test` sin regresiones; `openspec validate refine-forced-feature-switches --strict`.

## 5. Ignorar y restaurar de inmediato (seguimiento)

- [x] 5.1 `src/platformAccessory.ts` y `src/MatterThermostatAccessory.ts`: toda petición sobre un switch forzado (Mildew Proof y Screen Display; contraria o igual) no envía ningún comando; si es contraria, aviso; el estado se restaura de inmediato (HAP: `updateCharacteristicsFromDevice()`; Matter: `api.matter.updateAccessoryState(uuid, 'onOff', { onOff })` con el valor forzado).
- [x] 5.2 `src/__tests__/forcedFeatures.test.ts`: Screen Display y Mildew Proof forzados no envían comando ante peticiones contrarias ni iguales, en HAP y Matter; en Matter, `updateAccessoryState` recibe el valor forzado de inmediato; la petición igual no registra aviso.
- [x] 5.3 `README.md`: documentar que los switches forzados ignoran toda petición y se restauran de inmediato; el valor viaja solo cuando hace falta.
- [x] 5.4 `npm run build`, `npm run lint`, `npm test` y `openspec validate refine-forced-feature-switches --strict` sin regresiones.

## 6. Servicios obsoletos en caché (hallazgo de revisión)

- [x] 6.1 `src/platformAccessory.ts`: en `configureFeatureSwitches`, detectar también el servicio Switch ya presente en el accesorio cacheado (`getServiceById(Service.Switch, feature)`) para eliminarlo cuando el switch ya no debe exponerse (p. ej. el «Self Clean» forzado de beta.2 tras quitar `forceClean`).
- [x] 6.2 `src/__tests__/forcedFeatures.test.ts`: test HAP de un accesorio cacheado con un servicio Switch `clean` que ya no se expone → se elimina.
