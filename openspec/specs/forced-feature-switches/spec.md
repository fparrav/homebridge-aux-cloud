# forced-feature-switches Specification

## Purpose
Define cómo el plugin aplica overrides por dispositivo para características auxiliares del AC (Mildew Proof, Health y Screen Display) que HomeKit/Matter no pueden garantizar por sí solos, replicando el comportamiento de la app AUX Freedom: el ciclo post-apagado de Mildew Proof viaja en el payload que apaga el equipo, y la pantalla es un ajuste persistente.

## Requirements

### Requirement: Opciones de override por dispositivo
El sistema SHALL (DEBE) aceptar, en cada entrada de `devices[]`, las opciones `forceMildewProof` (boolean), `forceHealth` (boolean) y `forceScreenDisplay` (`none`, `forceOn` o `forceOff`), y identificar el dispositivo por `endpointId` o por `mac` (con basta uno). El sistema NO DEBE ofrecer una opción para forzar Self Clean (`ac_clean`).

#### Scenario: Dispositivo identificado por MAC
- **WHEN** una entrada de `devices[]` define únicamente `mac` con `forceScreenDisplay: "forceOff"`
- **THEN** el override se aplica a los comandos enviados a ese dispositivo

#### Scenario: Dispositivo sin ninguna opción de override
- **WHEN** un comando se envía a un dispositivo que no aparece en `devices[]` con opciones de override
- **THEN** el payload se envía sin modificaciones

#### Scenario: Config heredada con forceClean
- **WHEN** una entrada de `devices[]` todavía contiene `forceClean: true`
- **THEN** el valor se ignora, no se inyecta `ac_clean` en ningún comando y el switch Self Clean solo existe si está en `featureSwitches`

### Requirement: Override tri-state de Screen Display
El sistema SHALL aplicar `scrdisp: 1` o `scrdisp: 0` en todos los comandos enviados a un dispositivo cuando `forceScreenDisplay` sea `forceOn` o `forceOff`, respectivamente, y no debe modificar el payload cuando el valor es `none`.

#### Scenario: Pantalla forzada apagada
- **WHEN** un dispositivo tiene `forceScreenDisplay: "forceOff"` y HomeKit pide encender la pantalla
- **THEN** el comando enviado incluye `scrdisp: 0`

### Requirement: Switches forzados reportan el valor forzado
El sistema SHALL exponer el switch correspondiente de un dispositivo con override (Mildew Proof o Screen Display) aunque `featureSwitches` no lo incluya, reportar el valor forzado e ignorar toda petición sobre él: NO DEBE enviar ningún comando al equipo, SHALL registrar un aviso cuando la petición contradiga el valor forzado y SHALL restaurar de inmediato el estado del switch en HomeKit y en Matter.

#### Scenario: Petición Off sobre Mildew Proof forzado
- **WHEN** HomeKit o Matter pide apagar el switch Mildew Proof de un dispositivo con `forceMildewProof: true`
- **THEN** no se envía ningún comando, se registra un aviso y el switch vuelve a On de inmediato

#### Scenario: Petición contraria sobre Screen Display forzado
- **WHEN** HomeKit o Matter pide encender el switch Screen Display de un dispositivo con `forceScreenDisplay: "forceOff"`
- **THEN** no se envía ningún comando, se registra un aviso y el switch vuelve a Off de inmediato

#### Scenario: Petición igual al valor forzado
- **WHEN** HomeKit o Matter pide encender el switch Mildew Proof de un dispositivo con `forceMildewProof: true`
- **THEN** no se envía ningún comando y no se registra aviso

### Requirement: Inyección de Mildew Proof solo en el comando de apagado
El sistema SHALL inyectar `mldprf: 1` en cualquier comando cuyo payload contenga `pwr: 0` cuando `forceMildewProof` esté habilitado para ese dispositivo, sin importar el origen del comando (HomeKit, Matter, escena o automatización).

#### Scenario: Apagado desde HomeKit
- **WHEN** HomeKit pide apagar el dispositivo y el dispositivo tiene `forceMildewProof: true`
- **THEN** el comando enviado a AUX Cloud incluye `pwr: 0` y `mldprf: 1`

#### Scenario: Comando que no apaga el equipo
- **WHEN** se envía un cambio de modo o temperatura que no incluye `pwr: 0`
- **THEN** el payload no incluye `mldprf` por efecto del override

### Requirement: Health forzado mientras el equipo está encendido
El sistema SHALL inyectar `ac_health: 1` en los comandos enviados a un dispositivo con `forceHealth: true` cuando el equipo queda encendido (el comando trae `pwr: 1`, o no trae `pwr` y el dispositivo reporta `pwr: 1`), siempre que el dispositivo reporte `ac_health`. El sistema NO DEBE inyectarlo en un comando con `pwr: 0` ni cuando el equipo está apagado, y NO DEBE crear ni exponer un switch adicional por esta opción.

#### Scenario: Cambio de temperatura con el equipo encendido
- **WHEN** HomeKit cambia la temperatura de un dispositivo encendido con `forceHealth: true`
- **THEN** el comando enviado incluye `ac_health: 1`

#### Scenario: Apagado con Health forzado
- **WHEN** se envía un comando con `pwr: 0` a un dispositivo con `forceHealth: true`
- **THEN** el comando no incluye `ac_health`

#### Scenario: Sin switch adicional
- **WHEN** un dispositivo tiene `forceHealth: true` y `featureSwitches` no incluye `health`
- **THEN** no se registra ningún switch Health en HomeKit ni en Matter

### Requirement: Modelos sin soporte de un parámetro forzado
El sistema SHALL IGNORAR el override cuando el dispositivo no reporta el parámetro correspondiente, y SHALL registrar un único aviso por dispositivo y parámetro explicando que la opción se ignora.

#### Scenario: Modelo sin Health
- **WHEN** un dispositivo con `forceHealth: true` nunca reporta `ac_health` en sus parámetros
- **THEN** no se inyecta `ac_health` en ningún comando y el aviso aparece solo una vez
