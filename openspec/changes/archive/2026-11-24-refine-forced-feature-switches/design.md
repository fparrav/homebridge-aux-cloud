## Decisiones

- **Health forzado solo con el equipo encendido.** `ac_health: 1` se inyecta cuando el estado resultante es encendido: `params.pwr === 1`, o, si el comando no trae `pwr`, cuando `device.params.pwr === 1`. No se inyecta si el comando apaga (`pwr: 0`) ni si el equipo está apagado. Es solo opción de config: no se expone ningún switch ni se reporta valor forzado; el switch Health sigue el flujo normal de `featureSwitches`.
- **Mildew Proof sigue siendo post-apagado:** se inyecta `mldprf: 1` solo con `pwr: 0`.
- **Switches forzados: ignorar y restaurar.** Cualquier petición sobre un switch forzado (contraria o igual al valor) no envía ningún comando; si es contraria se registra un aviso. El estado del switch se restaura de inmediato: HAP con `updateCharacteristicsFromDevice()`, Matter empujando `updateAccessoryState(uuid, 'onOff', { onOff })` con el valor forzado en vez de esperar al siguiente poll. `scrdisp` forzado ya viaja en cada comando saliente vía `ForcedFeatureRegistry.apply`, así que el switch no necesita reenviarlo.
- **Helper compartido:** `resolveForcedValue(flags, param): boolean | undefined` exportado desde `src/forcedFeatures.ts`; ambos accesorios lo usan en lugar de su copia local.
- **Compatibilidad:** `forceClean` en configs existentes se ignora silenciosamente (no hay validación estricta de claves desconocidas en `devices[]`). `ForcedFeatureFlags.clean` se reemplaza por `health`.
- **Fuera de alcance:** CHANGELOG (lo genera el release) y cambios de comportamiento de `featureSwitches`.
