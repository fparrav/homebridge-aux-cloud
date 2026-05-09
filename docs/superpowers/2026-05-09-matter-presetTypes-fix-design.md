# Design: Fix Matter Thermostat Registration — presetTypes proper initialization

## Problema

Los accesorios Matter del plugin homebridge-aux-cloud fallan en registro con:
```
[presetTypes] Constraint "1 to 7": Array length 0 is not within bounds defined by constraint
```

`presetTypes: [0]` no funciona porque Matter espera un array de objetos `PresetType`, no números. El valor `[0]` pasa un número plano en lugar de un objeto con la estructura correcta.

## Hallazgos de investigación

### Estructura correcta de presetTypes

Según Matter spec v15.1 §4.3.9.42 y `@matter/types/clusters/thermostat`:

```typescript
// Cada entry debe ser un PresetType con:
// - presetScenario: PresetScenario enum (Occupied=1, Sleep=3, etc.)
// - numberOfPresets: number
// - presetTypeFeatures: { automatic?: boolean, supportsNames?: boolean }
```

### Cómo homebridge-matter lo hace

El plugin canonical `homebridge-plugins/homebridge-matter` configura el cluster thermostat con objetos `PresetType` correctamente instanciados.

### Código actual (INCORRECTO)

```typescript
// MatterThermostatAccessory.ts:126 (ANTES)
presetTypes: [0], // 0 = Home — no es válido
```

### Solución

Opción A: Instanciar `PresetType` desde `@matter/types/clusters/thermostat`
```typescript
import { Thermostat } from '@matter/types/clusters/thermostat';
// ...
presetTypes: [
    new Thermostat.PresetType({
        presetScenario: Thermostat.PresetScenario.Occupied,
        numberOfPresets: 1,
    })
]
```

Opción B: Usar objeto plano con la estructura correcta (si Matter lo acepta)
```typescript
presetTypes: [
    {
        presetScenario: 1, // Occupied
        numberOfPresets: 1,
        presetTypeFeatures: {},
    }
]
```

## Decisión

**Opción B** — objeto plano con la estructura correcta. Más simple, no requiere imports adicionales, y Matter.js valida por schema no por instanceof.

## Cambios implementados

### 1. MatterThermostatAccessory.ts

- Reemplazar `presetTypes: [0]` con objeto `PresetTypeStruct` válido
- Agregar `thermostatRunningMode` dinámico en `toAccessory()` y `refresh()`
- Nuevo método `getMatterThermostatRunningMode()`:
  - `systemMode === 0` → `0` (Off)
  - `systemMode === HEAT` → `0x01` (Heating)
  - `systemMode === COOL/DRY/FAN/AUTO` → `0x08` (Cooling)

### 2. Version bump

- v0.0.12-beta.32

## Testing

1. `npm run build` — ✅ compila exitosamente
2. Deploy a rpi1 vía Docker exec tar extract
3. Verificar logs: sin errores de `presetTypes` ni `Behaviors have errors`
4. Verificar que los accesorios Matter aparecen en HomeKit

## Resultado

- Matter accesorios registrados: `Aire Sala` y `Aire Dormitorio`
- 6 switch parts por dispositivo: Screen Display, Mildew Proof, Self Clean, Health Mode, Sleep Mode, Eco Mode
- Sin errores de `presetTypes constraint violation`
- Sin errores de `Accessory not found or not registered`
- `thermostatRunningMode` se actualiza correctamente en cada poll cycle

## Files modificados

- `src/MatterThermostatAccessory.ts` — fix principal (presetTypes, thermostatRunningMode)
- `package.json` — version bump a beta.32
