import { describe, expect, it } from 'vitest';

import { machineLabel } from './machineLabel';

describe('machineLabel', () => {
  it('calls a Mac a Mac', () => {
    expect(machineLabel('MacIntel')).toBe('This Mac');
    expect(machineLabel('MacPPC')).toBe('This Mac');
  });

  it('calls a Windows machine "This PC"', () => {
    expect(machineLabel('Win32')).toBe('This PC');
    expect(machineLabel('Win64')).toBe('This PC');
  });

  it('falls back to a neutral name on other platforms', () => {
    expect(machineLabel('Linux x86_64')).toBe('This device');
    expect(machineLabel('')).toBe('This device');
  });
});
