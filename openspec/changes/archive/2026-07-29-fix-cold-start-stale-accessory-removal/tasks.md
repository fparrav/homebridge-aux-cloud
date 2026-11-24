## 1. Preparación

- [x] 1.1 Releer `src/Platform.HAP.ts` (`refreshDevices`, `reconcileAccessories`, `getLanOnlyDevices`) para confirmar que la implementación no cambió desde el análisis en proposal.md/design.md antes de tocar código.

## 2. Implementación del filtro de staleness

- [x] 2.1 En `refreshDevices()`, capturar si el fetch cloud de la ronda actual tuvo éxito (`cloudFetchSucceeded: boolean`) y pasarlo a `reconcileAccessories(devices, cloudFetchSucceeded)`.
- [x] 2.2 En `reconcileAccessories`, calcular el set de `endpointId` LAN-only a partir de `getLanOnlyDevices()` al inicio del método.
- [x] 2.3 Modificar el filtro de `staleAccessories` (líneas ~496-510 actuales) para que, cuando `cloudFetchSucceeded` sea `false`, excluya de los candidatos a remoción cualquier accessory cuyo `context.device.endpointId` no esté en el set LAN-only (i.e., solo los LAN-only siguen siendo candidatos a stale en esa ronda).
- [x] 2.4 Verificar que cuando `cloudFetchSucceeded` es `true`, el comportamiento de remoción es idéntico al actual (sin regresión para el caso de dispositivo genuinamente eliminado de la cuenta).
- [x] 2.5 Confirmar que la actualización de `params`/estado optimista (uso de `lastKnownCloudDevices` para refrescar valores durante un fetch fallido) no se modifica — este cambio solo afecta la decisión de desregistro.

## 3. Tests

- [x] 3.1 Crear `src/__tests__/Platform.HAP.reconcileAccessories.test.ts` siguiendo el patrón de `platform.registerMatter.test.ts` (acceso a métodos privados vía `prototype`, mocks mínimos de `log`/`api`/`config`).
- [x] 3.2 Test: arranque en frío (sin `lastKnownCloudDevices` previo) + fetch cloud falla → el accessory cloud-only existente en `this.accessories` NO se pasa a `unregisterPlatformAccessories`.
- [x] 3.3 Test: fetch cloud falla en una ronda posterior a un fetch exitoso previo (caché en memoria no vacío) → tampoco se desregistra el accessory cloud-only (cubre el camino ya funcional hoy, para evitar regresión).
- [x] 3.4 Test: fetch cloud exitoso y el dispositivo no aparece en la respuesta → el accessory cloud-only SÍ se pasa a `unregisterPlatformAccessories` (caso de eliminación genuina, no debe romperse).
- [x] 3.5 Test: accessory LAN-only ausente de la configuración se desregistra igual sin importar si el fetch cloud de esa ronda tuvo éxito o falló.
- [x] 3.6 Ejecutar `npx jest src/__tests__/Platform.HAP.reconcileAccessories.test.ts` y la suite completa (`npm test`) para confirmar que no hay regresiones en `MatterThermostatAccessory.test.ts` ni `platform.registerMatter.test.ts`.

## 4. Validación final

- [x] 4.1 `npm run lint` sin errores nuevos.
- [x] 4.2 `npm run build` compila sin errores.
- [x] 4.3 Revisado con el usuario: el riesgo en `src/Platform.Matter.ts` es distinto (registro de accessory perdido en frío, no desregistro de un pairing existente) y requiere un cambio de mayor alcance (registro dinámico en `refreshPoll`). Se documenta en design.md ("Gap conocido en Platform.Matter.ts") y se deja fuera de este change por decisión explícita del usuario.
- [x] 4.4 Usuario confirmó: publicar release estable directamente (sin pasar por beta).
