## Why

En AUX Cloud, `mldprf` (Mildew Proof) y `ac_clean` (Self Clean) no son ajustes permanentes: viajan en el payload que **apaga** el equipo, y el AC ejecuta el ciclo posterior al apagado (secado del evaporador / auto-limpieza). Cuando el apagado llega por una escena, una automatización o un payload parcial de HomeKit/Matter, esos flags se pierden silenciosamente y el ciclo nunca corre.

Del lado de `scrdisp` (Screen Display) el problema es inverso: es un ajuste persistente, pero algunos modelos lo reportan inconsistente o el usuario quiere garantizar siempre una posición (por ejemplo, pantalla siempre apagada de noche) sin depender de lo que envía HomeKit.

Hoy el plugin solo expone estos switches si el usuario los activa en `featureSwitches` **y** el dispositivo reporta el parámetro, y no hay forma de forzar un valor independientemente de lo que pida HomeKit/Matter.

## What Changes

- Nuevas opciones **por dispositivo** en `devices[]`: `forceMildewProof` (boolean), `forceClean` (boolean) y `forceScreenDisplay` (`none` | `forceOn` | `forceOff`).
- El comando que sale del plugin se enriquece de forma centralizada:
  - `mldprf: 1` / `ac_clean: 1` se inyectan en **todo comando que apaga el equipo** (`pwr: 0`);
  - `scrdisp: 1` o `scrdisp: 0` se inyectan en **todo comando** cuando el modo no es `none`.
- El dispositivo se identifica por `endpointId` **o** `mac` (basta con uno).
- Los switches HomeKit/Matter correspondientes se exponen aunque `featureSwitches` esté vacío, reportan el valor forzado y las peticiones contrarias se ignoran (con un aviso en el log).
- Si el modelo nunca reporta el parámetro, la opción se ignora y se avisa **una sola vez** por dispositivo/parámetro.
- Sin cambios de comportamiento para dispositivos sin estas opciones.

## Capabilities

### New Capabilities
- `forced-feature-switches`: comportamiento de los overrides por dispositivo para Mildew Proof, Self Clean y Screen Display, incluyendo la inyección en payloads de apagado, la exposición de switches y la política para modelos no soportados.

### Modified Capabilities
(ninguna — `featureSwitches` conserva su comportamiento actual cuando no hay override)

## Impact

- **Código afectado**: nuevo `src/forcedFeatures.ts` (`ForcedFeatureRegistry`); `src/Platform.HAP.ts`, `src/Platform.Matter.ts` y `src/platform.ts` (legacy) registran el registro y aplican el override antes de `deviceControl.sendCommand`; `src/platformAccessory.ts` y `src/MatterThermostatAccessory.ts` exponen/reportan los switches forzados; `src/types.ts` agrega los tipos.
- **Configuración**: `config.schema.json` agrega las tres opciones por dispositivo.
- **Docs**: `README.md` documenta las opciones y su semántica.
- **Tests**: nuevo `src/__tests__/forcedFeatures.test.ts` (plataforma HAP, accessory HAP y accessory Matter).
- **Sin cambios** en el protocolo Broadlink ni en los proveedores cloud: el override se aplica antes de que el proveedor elija la ruta local/cloud.
