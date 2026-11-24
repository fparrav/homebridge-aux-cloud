## Why

La revisión de `v0.0.14-beta.2` encontró tres problemas en los switches forzados:

1. **Self Clean no debe forzarse.** `ac_clean` es un proceso que el equipo ejecuta solo cuando está apagado; forzarlo con `forceClean` no aporta y puede dispararlo en mal momento. Debe quedar únicamente el switch normal (`featureSwitches: ["clean"]`).
2. **Una petición "ignorada" igual manda un comando.** Con `forceMildewProof`, apagar el switch registra "ignoring…" pero envía `mldprf: 1` al equipo encendido, aunque ese parámetro solo debe viajar en el payload de apagado.
3. **Lógica duplicada.** `forcedValueForParam` está copiada en `platformAccessory.ts` y `MatterThermostatAccessory.ts`.

Además se quiere poder forzar **Health** (`ac_health`) mientras el equipo está encendido, como opción de configuración del plugin y sin agregar un switch extra a HomeKit/Matter.

## What Changes

- **BREAKING (solo beta):** se elimina la opción `forceClean` (código, schema, README, tipos). Una config que aún la traiga se ignora sin error; el switch Self Clean sigue disponible vía `featureSwitches`.
- Nueva opción por dispositivo `forceHealth` (boolean): inyecta `ac_health: 1` en todo comando que deja o mantiene el equipo **encendido**. Es solo configuración: no crea ni expone ningún switch nuevo en HomeKit/Matter (el switch Health normal sigue gobernado por `featureSwitches`).
- Toda petición sobre un switch forzado (Mildew Proof o Screen Display) se ignora: no se envía ningún comando. Si la petición contradice el valor forzado se registra un aviso, y en ambos casos el estado del switch se restaura de inmediato (HAP y Matter). El valor forzado viaja solo cuando hace falta: `mldprf` al apagar, `scrdisp` y `ac_health` en los comandos que ya se envían.
- La resolución del valor forzado por parámetro pasa a un único helper compartido por los dos accesorios.

## Capabilities

### Modified Capabilities
- `forced-feature-switches`: se retira Self Clean, se agrega Health y cambia la semántica de las peticiones contrarias.

## Impact

- `src/forcedFeatures.ts`, `src/types.ts`, `src/platform.ts` (tipos legacy), `config.schema.json`, `src/platformAccessory.ts`, `src/MatterThermostatAccessory.ts`, `src/__tests__/forcedFeatures.test.ts`, `README.md`.
- No cambia el comportamiento de dispositivos sin opciones de override.
