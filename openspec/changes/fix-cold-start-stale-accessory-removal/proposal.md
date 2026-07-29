## Why

Cuando `AuxCloudHAPPlatform.refreshDevices()` falla al obtener dispositivos de AUX Cloud (DNS, timeout, mantenimiento del servicio), el código usa `this.lastKnownCloudDevices` como respaldo en memoria para que los dispositivos cloud-only no se marquen como "stale". Ese caché vive solo en memoria del proceso: tras un reinicio de Homebridge (crash, redeploy, recreación de contenedor), si el **primer** fetch cloud tras arrancar falla, el caché está vacío y no hay respaldo. El dispositivo cloud-only queda fuera del set `seen` de esa ronda y `reconcileAccessories` lo trata como eliminado, llamando a `unregisterPlatformAccessories`. Esa llamada borra el pairing HomeKit del accessory — el usuario pierde la asignación de habitación, nombres personalizados y cualquier automatización/escena que lo referenciara, aunque el dispositivo siga existiendo en la cuenta AUX Cloud.

Esto se reprodujo en producción: un corte de red breve recreó el container de Homebridge con `/etc/resolv.conf` vacío, el primer sync falló con `EAI_AGAIN`, y ~1s después el log mostró `Removing 1 stale AUX Cloud accessories` para "Aire Dormitorio" (el único AC con `controlStrategy: "cloud"`). El patrón se repite en cualquier arranque en frío donde el primer fetch cloud falle transitoriamente, sin importar la causa.

## What Changes

- `AuxCloudHAPPlatform.reconcileAccessories` deja de desregistrar accesorios respaldados por AUX Cloud cuando la ronda de reconciliación actual corresponde a un fetch cloud que falló, sin importar si hay o no caché previo en memoria.
- Un accessory cloud-only solo se trata como "genuinamente eliminado de la cuenta" (y por tanto candidato a desregistro) cuando un fetch cloud de la ronda actual tuvo éxito y el dispositivo no aparece en esa respuesta — nunca en base a un fetch fallido, sea el primero tras arrancar o cualquier otro posterior.
- Los accesorios LAN-only no se ven afectados: su presencia en `seen` no depende del fetch cloud y la lógica de remoción para ellos no cambia.
- Sin cambios de comportamiento cuando el fetch cloud tiene éxito: la remoción de accesorios que genuinamente ya no están en la cuenta AUX Cloud sigue funcionando igual.

## Capabilities

### New Capabilities
- `accessory-reconciliation`: reglas que determinan cuándo un accessory HomeKit respaldado por un dispositivo AUX Cloud o LAN puede desregistrarse como "stale", incluyendo el comportamiento ante fallos de fetch a AUX Cloud.

### Modified Capabilities
(ninguna — no existen specs previos para esta capability)

## Impact

- **Código afectado**: `src/Platform.HAP.ts` (`refreshDevices`, `reconcileAccessories`, y el estado `lastKnownCloudDevices`). El mismo patrón existe en `src/Platform.Matter.ts` (`discoverAndRegisterDevices`, `refreshPoll`) pero ese flujo no ejecuta hoy ningún desregistro de accesorios Matter por "stale" tras fallo de fetch — solo se actualiza para mantener el mismo criterio de caché válido/inválido y evitar que diverja en el futuro. `src/platform.ts` es la clase legacy no registrada en runtime (ver CLAUDE.md); no se modifica salvo que el usuario pida paridad explícita.
- **Tests**: nuevo test en `src/__tests__/` que reproduce arranque en frío + primer fetch cloud fallido y verifica que `unregisterPlatformAccessories` no se llama para el accessory cloud-only.
- **Sin cambios de API pública** ni de configuración del plugin.
