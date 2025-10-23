# Homebridge AUX Cloud Platform

Homebridge plugin scaffold for integrating AUX Cloud connected appliances with Apple HomeKit. This project was bootstrapped using the official [homebridge/homebridge-plugin-template](https://github.com/homebridge/homebridge-plugin-template) and is ready to host the real API logic.

## Getting Started

```bash
npm install
npm run build
```

Add the platform to your Homebridge `config.json`:

```json
{
  "platform": "AuxCloudPlatform",
  "name": "Aux Cloud",
  "username": "user@example.com",
  "password": "your-password",
  "pollInterval": 60
}
```

The configuration schema under `config.schema.json` enables UI configuration within Homebridge Config UI X.

## Development

- `npm run lint` – check code style with ESLint.
- `npm run build` – type-check and compile TypeScript to `dist/`.
- `npm run watch` – compile TypeScript in watch mode.

The generated `src/` directory contains placeholder implementations mirroring the template. Replace the mock discovery logic with actual AUX Cloud API calls and expand the accessory characteristics as needed.
