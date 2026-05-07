import { AuxCloudPlatform } from '../platform';

function callRegisterOrResume(
  context: { log: unknown; api: unknown; cachedMatterAccessories: Map<string, unknown> },
  accessories: unknown[],
  deviceName: string,
): Promise<void> {
  const method = (AuxCloudPlatform.prototype as unknown as Record<string, (...args: unknown[]) => Promise<void>>)['registerOrResumeAccessories'];
  return method.call(context, accessories, deviceName) as Promise<void>;
}

function makeContext(opts: {
  cachedAccessories?: Record<string, unknown>;
  registerPlatformAccessories?: jest.Mock;
  unregisterPlatformAccessories?: jest.Mock;
  updatePlatformAccessories?: jest.Mock;
} = {}) {
  const cachedMap = new Map<string, unknown>(Object.entries(opts.cachedAccessories ?? {}));
  return {
    log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    api: {
      matter: {
        registerPlatformAccessories: opts.registerPlatformAccessories ?? jest.fn().mockResolvedValue(undefined),
        unregisterPlatformAccessories: opts.unregisterPlatformAccessories ?? jest.fn().mockResolvedValue(undefined),
        updatePlatformAccessories: opts.updatePlatformAccessories ?? jest.fn().mockResolvedValue(undefined),
      },
    },
    cachedMatterAccessories: cachedMap,
  };
}

describe('AuxCloudPlatform.registerOrResumeAccessories', () => {
  test('registers fresh when UUID not in cache: calls register then update', async () => {
    const mockRegister = jest.fn().mockResolvedValue(undefined);
    const mockUpdate = jest.fn().mockResolvedValue(undefined);

    const ctx = makeContext({ registerPlatformAccessories: mockRegister, updatePlatformAccessories: mockUpdate });
    await callRegisterOrResume(ctx, [{ UUID: 'test-uuid', handlers: {}, parts: [] }], 'Aire Sala');

    // Non-cached path: BOTH register (fresh/identity-conflict) AND update (populate accessories Map)
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('resumes via updatePlatformAccessories when UUID is in cache', async () => {
    const mockRegister = jest.fn();
    const mockUpdate = jest.fn().mockResolvedValue(undefined);

    const cachedAccessory = { UUID: 'test-uuid', handlers: {}, parts: [] };
    const ctx = makeContext({
      cachedAccessories: { 'test-uuid': cachedAccessory },
      registerPlatformAccessories: mockRegister,
      updatePlatformAccessories: mockUpdate,
    });

    const newAcc = { UUID: 'test-uuid', handlers: { onSet: jest.fn() }, parts: [{ UUID: 'part-1' }] };
    await callRegisterOrResume(ctx, [newAcc], 'Aire Sala');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith([cachedAccessory]);
    expect(mockRegister).not.toHaveBeenCalled();
    // Handlers and parts must be re-attached onto the cached object
    expect((cachedAccessory as Record<string, unknown>).handlers).toBe(newAcc.handlers);
    expect((cachedAccessory as Record<string, unknown>).parts).toBe(newAcc.parts);
  });

  test('throws when registerPlatformAccessories fails with non-identity error', async () => {
    const mockRegister = jest.fn().mockRejectedValue(new Error('[enum-value-conformance] conformance error'));

    const ctx = makeContext({ registerPlatformAccessories: mockRegister });
    await expect(callRegisterOrResume(ctx, [{ UUID: 'new-uuid' }], 'Aire Sala')).rejects.toThrow('conformance error');
  });

  test('throws when updatePlatformAccessories fails', async () => {
    const mockUpdate = jest.fn().mockRejectedValue(new Error('update failed'));
    const cachedAccessory = { UUID: 'test-uuid' };
    const ctx = makeContext({
      cachedAccessories: { 'test-uuid': cachedAccessory },
      updatePlatformAccessories: mockUpdate,
    });

    await expect(callRegisterOrResume(ctx, [{ UUID: 'test-uuid' }], 'Aire Sala')).rejects.toThrow('update failed');
  });

  test('processes each accessory independently (mix of cached and new)', async () => {
    const mockRegister = jest.fn().mockResolvedValue(undefined);
    const mockUpdate = jest.fn().mockResolvedValue(undefined);
    const cachedAccessory = { UUID: 'uuid-cached' };

    const ctx = makeContext({
      cachedAccessories: { 'uuid-cached': cachedAccessory },
      registerPlatformAccessories: mockRegister,
      updatePlatformAccessories: mockUpdate,
    });

    await callRegisterOrResume(
      ctx,
      [{ UUID: 'uuid-cached' }, { UUID: 'uuid-new' }],
      'Test Device',
    );

    // Cached path (uuid-cached): update called once (no register)
    // Non-cached path (uuid-new): register + update both called
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });
});
