## Purpose

Define cuándo un accessory HomeKit respaldado por un dispositivo AUX Cloud o LAN puede desregistrarse como "stale" durante la reconciliación periódica, evitando que fallos transitorios de conectividad a AUX Cloud causen la pérdida del pairing HomeKit de dispositivos que siguen existiendo en la cuenta.

## ADDED Requirements

### Requirement: No desregistro de accesorios cloud-only por fallo de fetch
El sistema SHALL NOT (NO DEBE) desregistrar (`unregisterPlatformAccessories`) un accessory HomeKit respaldado por un dispositivo AUX Cloud cuando la ronda de reconciliación actual se basa en un fetch a AUX Cloud que falló, independientemente de si existe o no un caché previo de dispositivos.

#### Scenario: Primer fetch cloud tras arranque en frío falla
- **WHEN** el proceso arranca sin caché de dispositivos AUX Cloud en memoria y el primer intento de `listDevices()` falla (error de red, DNS, timeout, mantenimiento del servicio)
- **THEN** ningún accessory HomeKit respaldado por un dispositivo AUX Cloud se desregistra como consecuencia de esa ronda

#### Scenario: Fetch cloud falla después de arrancar exitosamente
- **WHEN** el proceso ya completó al menos un fetch cloud exitoso y una ronda posterior de `listDevices()` falla
- **THEN** ningún accessory HomeKit respaldado por un dispositivo AUX Cloud se desregistra como consecuencia de esa ronda, y el sistema conserva los dispositivos cloud conocidos de la última respuesta exitosa

### Requirement: Desregistro solo tras confirmación positiva de eliminación
El sistema SHALL (DEBE) tratar un accessory cloud-only como candidato a desregistro únicamente cuando un fetch cloud exitoso confirma que el dispositivo ya no está presente en la respuesta de la cuenta AUX Cloud.

#### Scenario: Dispositivo genuinamente eliminado de la cuenta AUX Cloud
- **WHEN** un fetch cloud exitoso retorna la lista de dispositivos de la cuenta y un dispositivo previamente conocido no aparece en esa lista
- **THEN** el accessory HomeKit correspondiente se desregistra como stale

#### Scenario: Dispositivo sigue presente en fetch exitoso
- **WHEN** un fetch cloud exitoso retorna un dispositivo previamente conocido
- **THEN** el accessory HomeKit correspondiente no se desregistra

### Requirement: Remoción de accesorios LAN-only no afectada
El comportamiento de reconciliación para accesorios respaldados exclusivamente por dispositivos LAN SHALL NOT (NO DEBE) cambiar: su elegibilidad para desregistro es independiente del resultado del fetch a AUX Cloud.

#### Scenario: Dispositivo LAN-only eliminado de la configuración
- **WHEN** un dispositivo LAN-only deja de estar presente en la configuración del plugin durante una ronda de reconciliación
- **THEN** el accessory HomeKit correspondiente se desregistra como stale, sin importar si el fetch cloud de esa misma ronda tuvo éxito o falló
