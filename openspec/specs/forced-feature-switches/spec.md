# forced-feature-switches Specification

## Purpose
Define cómo el plugin aplica overrides por dispositivo para características auxiliares del AC (Mildew Proof, Self Clean y Screen Display) que HomeKit/Matter no pueden garantizar por sí solos, replicando el comportamiento de la app AUX Freedom: los ciclos post-apagado viajan en el payload que apaga el equipo, y la pantalla es un ajuste persistente.

## Requirements

### Requirement: Opciones de override por dispositivo
El sistema SHALL (DEBE) aceptar, en cada entrada de `devices[]`, las opciones `forceMildewProof` (boolean), `forceClean` (boolean) y `forceScreenDisplay` (`none`, `forceOn` o `forceOff`), y identificar el dispositivo por `endpointId` o por `mac` (con basta uno).

#### Scenario: Dispositivo identificado por MAC
- **WHEN** una entrada de `devices[]` define únicamente `mac` con `forceScreenDisplay: "forceOff"`
- **THEN** el override se aplica a los comandos enviados a ese dispositivo

#### Scenario: Dispositivo sin ninguna opción de override
- **WHEN** un comando se envía a un dispositivo que no aparece en `devices[]` con opciones de override
- **THEN** el payload se envía sin modificaciones

### Requirement: Inyección de Mildew Proof y Self Clean en el comando de apagado
El sistema SHALL inyectar `mldprf: 1` (o `ac_clean: 1`) en cualquier comando cuyo payload contenga `pwr: 0` cuando `forceMildewProof` (o `forceClean`) esté habilitado para ese dispositivo, sin importar el origen del comando (HomeKit, Matter, escena o automatización).

#### Scenario: Apagado desde HomeKit
- **WHEN** HomeKit pide apagar el dispositivo y el dispositivo tiene `forceMildewProof: true`
- **THEN** el comando enviado a AUX Cloud incluye `pwr: 0` y `mldprf: 1`

#### Scenario: Comando que no apaga el equipo
- **WHEN** se envía un cambio de modo o temperatura que no incluye `pwr: 0`
- **THEN** el payload no incluye `mldprf` ni `ac_clean` por efecto del override

### Requirement: Override tri-state de Screen Display
El sistema SHALL aplicar `scrdisp: 1` o `scrdisp: 0` en todos los comandos enviados a un dispositivo cuando `forceScreenDisplay` sea `forceOn` o `forceOff`, respectivamente, y no debe modificar el payload cuando el valor es `none`.

#### Scenario: Pantalla forzada apagada
- **WHEN** un dispositivo tiene `forceScreenDisplay: "forceOff"` y HomeKit pide encender la pantalla
- **THEN** el comando enviado incluye `scrdisp: 0`

### Requirement: Switches forzados reportan el valor forzado
El sistema SHALL exponer el switch correspondiente de un dispositivo con override aunque `featureSwitches` no lo incluya, reportar el valor forzado, ignorar las peticiones contrarias y registrar un aviso en el log cuando se reciba una petición contraria.

#### Scenario: Petición Off sobre Mildew Proof forzado
- **WHEN** HomeKit o Matter pide apagar el switch Mildew Proof de un dispositivo con `forceMildewProof: true`
- **THEN** el payload enviado contiene `mldprf: 1` y el switch permanece en On

### Requirement: Modelos sin soporte del parámetro
El sistema SHALL IGNORAR el override cuando el dispositivo no reporta el parámetro correspondiente, y SHALL registrar un único aviso por dispositivo y parámetro explicando que la opción se ignora.

#### Scenario: Modelo sin Self Clean
- **WHEN** un dispositivo con `forceClean: true` nunca reporta `ac_clean` en sus parámetros
- **THEN** no se inyecta `ac_clean` en ningún comando y el aviso aparece solo una vez
