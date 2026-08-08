import { describe, expect, it } from 'vitest';

import { Vendor } from './frame';
import { blockedReason, isBlocked } from './unsafe';

describe('unsafe command guard', () => {
  it('blocks factory reset', () => {
    expect(blockedReason(Vendor.Sennheiser, 0x0040)).toBe('factory reset');
  });

  it('blocks the whole Sennheiser firmware-upgrade range', () => {
    for (const command of [0x0200, 0x0201, 0x0250, 0x02ff]) {
      expect(isBlocked(Vendor.Sennheiser, command), command.toString(16)).toBe(true);
    }
  });

  it('blocks the Qualcomm upgrade transport', () => {
    expect(isBlocked(Vendor.Qualcomm, 0x0c00)).toBe(true);
    expect(isBlocked(Vendor.Qualcomm, 0x0c02)).toBe(true);
  });

  it('blocks paired-device deletion but not the rest of the device list', () => {
    expect(isBlocked(Vendor.Sennheiser, 0x1405)).toBe(true);
    expect(isBlocked(Vendor.Sennheiser, 0x1406)).toBe(true);
    expect(isBlocked(Vendor.Sennheiser, 0x1400)).toBe(false);
  });

  it('does not block a command that merely shares an ID across vendors', () => {
    // 0x0804 erases the panic log on Qualcomm, but is a normal audio setting
    // in the Sennheiser range.
    expect(isBlocked(Vendor.Qualcomm, 0x0804)).toBe(true);
    expect(isBlocked(Vendor.Sennheiser, 0x0804)).toBe(false);
  });

  it('allows every command the app actually sends', () => {
    const used = [
      0x0603, 0x0602, 0x1202, 0x1206, 0x0800, 0x0402, 0x1a05, 0x1a04, 0x1a01, 0x1a00, 0x1a03,
      0x1a02, 0x1805, 0x1804, 0x1009, 0x1008, 0x0601, 0x0600, 0x080d, 0x080c, 0x0401, 0x0400,
      0x080b, 0x080a, 0x0815, 0x0814, 0x0818, 0x0817, 0x0406, 0x0405, 0x1607, 0x1606, 0x0806,
      0x0805, 0x0007,
    ];
    for (const command of used) {
      expect(isBlocked(Vendor.Sennheiser, command), command.toString(16)).toBe(false);
    }
    expect(isBlocked(Vendor.Qualcomm, 0x0003)).toBe(false);
  });
});
