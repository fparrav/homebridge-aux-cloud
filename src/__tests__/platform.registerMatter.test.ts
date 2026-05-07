import { AuxCloudPlatform } from '../platform';

// Bind the private method from the class prototype to a minimal context object.
// This lets us test the implementation without constructing the full platform.
function callRegisterOrResume(
  context: { log: unknown; api: unknown },
  accessories: unknown[],
  deviceName: string,
): Promise<void> {
  const method = (AuxCloudPlatform.prototype as unknown as Record<string, Function>)['registerOrResumeAccessories'];
  return method.call(context, accessories, deviceName) as Promise<void>;
}

function makeContext(matterOverrides: {
  registerPlatformAccessories?: jest.Mock;
  unregisterPlatformAccessories?: jest.Mock;
} = {}) {
  return {
    log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    api: {
      matter: {
        registerPlatformAccessories: matterOverrides.registerPlatformAccessories ?? jest.fn().mockResolvedValue(undefined),
        unregisterPlatformAccessories: matterOverrides.unregisterPlatformAccessories ?? jest.fn().mockResolvedValue(undefined),
      },
    },
  };
}

describe('AuxCloudPlatform.registerOrResumeAccessories — stale persistence recovery', () => {
  test('unregisters and re-registers when Matter says "already defined"', async () => {
    const mockUnregister = jest.fn().mockResolvedValue(undefined);
    const mockRegister = jest.fn()
      .mockRejectedValueOnce(new Error('[identity-conflict] 0ED982F8 already defined'))
      .mockResolvedValueOnce(undefined);

    const ctx = makeContext({ registerPlatformAccessories: mockRegister, unregisterPlatformAccessories: mockUnregister });
    await callRegisterOrResume(ctx, [{ UUID: 'test-uuid' }], 'Aire Sala');

    expect(mockUnregister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(2);
  });

  test('does not unregister when registration succeeds on first attempt', async () => {
    const mockUnregister = jest.fn();
    const mockRegister = jest.fn().mockResolvedValue(undefined);

    const ctx = makeContext({ registerPlatformAccessories: mockRegister, unregisterPlatformAccessories: mockUnregister });
    await callRegisterOrResume(ctx, [{ UUID: 'test-uuid' }], 'Aire Sala');

    expect(mockUnregister).not.toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  test('throws when registration fails with a non-identity error', async () => {
    const mockRegister = jest.fn().mockRejectedValue(new Error('[enum-value-conformance] conformance error'));

    const ctx = makeContext({ registerPlatformAccessories: mockRegister });
    await expect(callRegisterOrResume(ctx, [{ UUID: 'test-uuid' }], 'Aire Sala')).rejects.toThrow('conformance error');
  });
});
