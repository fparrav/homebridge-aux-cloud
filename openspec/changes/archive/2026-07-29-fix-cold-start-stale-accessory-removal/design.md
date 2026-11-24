## Context

Ver `proposal.md` - Why para la motivación completa. Puntos relevantes para el diseño:

- `AuxCloudHAPPlatform.reconcileAccessories(devices)` recibe `allDevices = [...cloudDevices, ...lanOnlyDevices]` y calcula `seen` a partir de los `endpointId` presentes en esa lista. Cualquier accessory registrado cuyo UUID no esté en `seen` se desregistra.
- Cuando `listDevices()` falla, el código actual sustituye `cloudDevices` por `this.lastKnownCloudDevices` (caché en memoria del proceso). Ese caché se puebla solo tras un fetch exitoso previo **en el proceso actual** — no sobrevive un restart.
- Homebridge, no el plugin, persiste en disco los `PlatformAccessory` ya registrados (incluido `context.device.endpointId`, `productId`, `friendlyName`) y los restaura vía `configureAccessory()` antes de `didFinishLaunching`. Es decir, `this.accessories` en el primer `reconcileAccessories()` tras un restart ya contiene los accessories cloud-only conocidos de la sesión anterior, con su `endpointId` disponible en `context.device` — independientemente de si el fetch cloud de esta sesión tuvo éxito.
- `getLanOnlyDevices()` deriva su lista de la configuración estática del plugin (`config.devices` con `controlStrategy` LAN o sin cloud), no de una llamada de red — siempre está disponible, incluso en el primer ciclo.

## Goals / Non-Goals

**Goals:**
- Ningún accessory cloud-only se desregistra en una ronda donde el fetch cloud de AUX Cloud falló, en frío o en caliente.
- El caso "dispositivo genuinamente eliminado de la cuenta AUX Cloud" se sigue detectando y limpiando, usando únicamente fetches cloud exitosos como fuente de verdad.
- La lógica de remoción de accesorios LAN-only no cambia.
- Sin nuevas dependencias, sin I/O a disco adicional, sin nueva configuración de usuario.

**Non-Goals:**
- No se resuelve la persistencia general de `lastKnownCloudDevices` a disco (se evalúa como alternativa y se descarta, ver Decisions).
- No se cambia el comportamiento de actualización de `params`/estado de los dispositivos durante un fetch fallido (sigue usando el caché en memoria cuando existe, solo para refrescar valores, no para decidir remoción).
- No se toca `src/platform.ts` (legacy, no registrado en runtime).
- No se implementa un fix para `src/Platform.Matter.ts` en este change. Se investigó durante la implementación (ver "Gap conocido en Platform.Matter.ts (no implementado)" más abajo) y se confirmó que el riesgo ahí es distinto al de HAP y no equivalente a este bug — se documenta pero se deja fuera de alcance deliberadamente, decisión tomada con el usuario.

## Decisions

### Mecanismo: excluir accesorios cloud-backed de la comprobación de staleness cuando el fetch de la ronda falló

En `reconcileAccessories`, se recibe (o se calcula) un flag `cloudFetchSucceeded: boolean` para la ronda actual. Al construir el set de accesorios candidatos a "stale":

- Si `cloudFetchSucceeded` es `true`: comportamiento actual sin cambios — cualquier accessory no presente en `seen` es candidato a remoción (cloud o LAN).
- Si `cloudFetchSucceeded` es `false`: un accessory solo es candidato a remoción si es **LAN-only** (su `endpointId` tiene el prefijo determinístico `lan-`, ver "Cómo se calcula LAN-only para el filtro" más abajo). Los accesorios cuyo `endpointId` no tiene ese prefijo se consideran "presuntamente cloud" y se excluyen de la comprobación de staleness para esa ronda, sin importar si aparecen o no en `seen`.

Esto reemplaza la dependencia de `lastKnownCloudDevices` como mecanismo de protección contra desregistro (aunque el caché en memoria se conserva para seguir refrescando `params`/estado durante una ronda con fetch fallido, que es un problema distinto y ya resuelto). La fuente de verdad para "qué accessories existen" pasa a ser `this.accessories`, que Homebridge ya persiste y restaura en disco de forma nativa — sobrevive un restart sin que el plugin tenga que implementar su propia persistencia.

**Alternativas consideradas:**
1. **Persistir `lastKnownCloudDevices` en disco** (storage path de Homebridge) y cargarlo antes del primer `reconcileAccessories`. Descartada: agrega I/O de archivo, manejo de errores de lectura/escritura, y un caché adicional que puede desincronizarse del estado real de `this.accessories`/Homebridge. El mecanismo elegido logra el mismo resultado apoyándose en persistencia que Homebridge ya garantiza.
2. **Período de gracia por N fallos consecutivos** antes de tratar accesorios cloud-only como stale. Descartada: sigue siendo vulnerable si el proceso se reinicia repetidamente con fallos transitorios (cada restart resetea el contador a 0 si se guarda en memoria, o requiere persistir el contador en disco, reintroduciendo el problema de la alternativa 1). Además introduce un parámetro de tuning ("¿cuántos fallos son demasiados?") sin necesidad.
3. **Mecanismo elegido**: sin contador, sin persistencia propia, sin período de gracia — la protección es binaria y depende de una señal ya disponible sin red (fetch exitoso de la ronda actual) y de un dato ya persistido por el framework (`this.accessories`). Es la opción más simple que resuelve el problema exactamente descrito.

### Cómo se calcula "LAN-only" para el filtro

Se descartó derivar el conjunto LAN-only desde `getLanOnlyDevices()` (la configuración *actual*): si un dispositivo LAN-only se elimina de la configuración, `getLanOnlyDevices()` deja de incluirlo, por lo que ya no aparecería en ese conjunto — el filtro lo protegería por error en vez de desregistrarlo, violando el requisito "remoción de accesorios LAN-only no afectada".

En su lugar, el filtro usa el propio `endpointId` persistido en `accessory.context.device.endpointId`: los `endpointId` de dispositivos LAN-only siempre tienen el prefijo determinístico `lan-<mac-sin-dos-puntos>` (generado en `getLanOnlyDevices()`, y de forma idéntica en `Platform.Matter.ts` y en el legacy `platform.ts`), mientras que los `endpointId` de AUX Cloud son opacos y nunca tienen ese prefijo. Un accessory es LAN-only si su `endpointId` empieza con `lan-`, sin importar si ese dispositivo sigue o no en la configuración actual. Esto distingue correctamente "LAN-only eliminado de la config" (sigue siendo candidato a stale) de "cloud-backed sin confirmar" (protegido). No se requiere nuevo estado ni nueva llamada de red.

## Risks / Trade-offs

- **[Riesgo]** Si un accessory cloud-only nunca llega a tener un fetch cloud exitoso durante toda la vida del proceso (fallos persistentes de red o cuenta AUX Cloud caída por horas/días), nunca se desregistrará aunque el dispositivo haya sido eliminado legítimamente de la cuenta mientras tanto. → **Mitigación**: es el comportamiento deseado — ante ausencia de confirmación, se prefiere preservar el pairing HomeKit (reversible manualmente por el usuario) sobre desregistrar por error (no reversible sin perder configuración de HomeKit). Este trade-off es explícito en el proposal.
- **[Riesgo descartado]** Un accessory que cambia de LAN-only a cloud-only (o viceversa) podría clasificarse mal si el criterio dependiera de la configuración *actual*. No aplica con el mecanismo elegido: el prefijo `lan-` del `endpointId` es inmutable y determinístico (deriva del MAC, no de `config.devices`), así que la clasificación no depende de si la configuración cambió — un accessory LAN-only que pasa a controlarse por cloud recibe un `endpointId` cloud distinto (nunca `lan-`), y el accessory viejo con el `endpointId` `lan-` queda correctamente como candidato a stale.
- **[Trade-off]** Durante una ronda con fetch fallido, los accesorios cloud-backed no reciben actualización de estado ni se re-evalúan sus `params` (comportamiento ya existente, sin cambios) — este diseño solo afecta la decisión de desregistro, no la de actualización.

## Migration Plan

No aplica migración de datos ni de configuración. Es un cambio de lógica interna en `Platform.HAP.ts`, desplegado como parte de una release normal (patch). Rollback: revertir el commit/versión, sin pasos adicionales.

## Gap conocido en Platform.Matter.ts (no implementado)

Se investigó si `Platform.Matter.ts` necesita el mismo fix, dado que comparte el patrón `lastKnownCloudDevices`. Conclusión: el riesgo ahí es **distinto** al de HAP, no una variante del mismo bug:

- `discoverAndRegisterDevices()` — el método que construye `devicesById` y registra los accessories Matter (`registerMatterAccessoriesInternal`) — se ejecuta **una sola vez**, al arrancar el proceso (llamado desde el flujo de inicialización, no desde el poll loop).
- Si el primer fetch cloud falla en frío (mismo escenario que el bug de HAP: `lastKnownCloudDevices` vacío), el dispositivo cloud-only queda fuera de `allDevices` en esa única ejecución y **nunca se registra un accessory Matter para él durante toda la vida del proceso** — no hasta el próximo restart completo.
- A diferencia de HAP, no hay ningún `unregisterPlatformAccessories`/`api.matter.unregisterPlatformAccessories` disparado por esta ausencia — el accessory simplemente nunca se crea esa sesión. `refreshPoll()` (el loop periódico) solo llama `refreshMatterState()`, que itera `this.matterAccessories` (la lista ya fija desde el arranque) y nunca registra accessories nuevos.
- Es decir: el bug de HAP es "se destruye un pairing existente por error" (regresión activa, remediable solo re-emparejando). El gap de Matter es "un dispositivo nunca aparece esta sesión" (omisión pasiva, se autorepara con un restart del proceso, y no hay pérdida de configuración de Apple Home porque el accessory nunca llegó a registrarse).

**Decisión (con el usuario, 2026-07-29)**: no implementar un fix para este gap en este change. Arreglarlo de verdad requeriría que `refreshPoll()` también registre accessories Matter nuevos para dispositivos que no estaban en `devicesById` al arrancar — un cambio de alcance distinto (registro dinámico durante el poll, no solo al inicio) que no está cubierto por `specs/accessory-reconciliation/spec.md` tal como está escrito. Amerita su propio proposal si se decide abordarlo.
