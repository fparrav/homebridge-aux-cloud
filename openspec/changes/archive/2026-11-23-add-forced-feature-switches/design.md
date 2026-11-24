## Decision 1: registro centralizado en la plataforma, no en los accesorios

`ForcedFeatureRegistry` (`src/forcedFeatures.ts`) se construye una vez a partir de `config.devices` y se consulta por `endpointId` o `mac` (normalizado a minúsculas). La aplicación del override ocurre en `sendDeviceParamsWithRetry` de cada plataforma, justo antes de `deviceControl.sendCommand`:

```ts
await this.deviceControl.sendCommand(
  device,
  this.forcedFeatures.apply(device, params),
  { globalStrategy, localRetryCount, cloudRetryCount },
);
```

**Por qué**: es el único punto por el que pasan *todos* los comandos (HomeKit, Matter, escenas, automaciones, polling manual). Hacerlo en los accesorios dejaría fuera los comandos que no nacen de un switch, y duplicaría la lógica entre HAP y Matter.

## Decision 2: `mldprf` y `ac_clean` se inyectan solo en comandos de apagado

La app oficial de AUX Freedom manda estos flags junto con `pwr: 0`; son ciclos post-apagado. Inyectarlos en comandos que no apagan el equipo (cambio de modo/temperatura) no tiene efecto y ensucia el payload, por eso la condición es `params[AC_POWER] === 0`.

## Decision 3: `scrdisp` es tri-state

La pantalla es un ajuste persistente, así que un boolean no alcanza: `none` delega en HomeKit/Matter, `forceOn` y `forceOff` escriben el valor en cada comando. El tipo `ScreenDisplayForceMode` queda expuesto en `config.schema.json` con `enum` para que Config UI X valide el valor.

## Decision 4: exposición de switches aunque el usuario no los enumeró en `featureSwitches`

Si un dispositivo tiene un override, su switch se crea igualmente y reporta el valor forzado; una petición contraria se ignora y se loguea. Sin esto, el usuario vería un switch que dice Off mientras el plugin manda On, o simplemente no tendría forma de interactuar con la característica.

## Decision 5: modelos no soportados → ignorar + warning una vez

La detección usa `device.params` (lo que el dispositivo reporta). Si el parámetro no existe, no se inyecta y se avisa una única vez por `(endpointId, param)` para no llenar el log en cada polling.

## Alternativas descartadas

- **Override global** (`forceMildewProof` a nivel de plataforma): no sirve porque conviven modelos con y sin soporte en la misma cuenta.
- **Forzar solo desde el switch HomeKit**: no cubre escenas/automatizaciones ni comandos parciales, que es precisamente el caso que falla en producción.
- **Inyectar en `AuxDeviceControl.sendCommand`**: quedaría fuera el camino LAN de dispositivos discovery-only y mezclaría responsabilidades (el control de transporte no debe conocer la configuración de la plataforma).
