import { describe, expect, it } from 'vitest';

import { Command, Reply } from './commands';
import {
  BUTTON_MODE_OPTIONS,
  ButtonMode,
  decodeAssignable,
  encodeGetAssignable,
  encodeSetAssignable,
  isAssignableReply,
} from './assignable';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);

describe('assignable touch controls (SYSTEM param 0x03)', () => {
  it('reads with the plain system-param form', () => {
    expect(encodeGetAssignable()).toEqual([Command.GetSystemParam, 0x03]);
  });

  it('writes both sides with the count byte between', () => {
    expect(
      encodeSetAssignable(ButtonMode.PlaybackControl, ButtonMode.AmbientSoundControl),
    ).toEqual([Command.SetSystemParam, 0x03, 0x02, ButtonMode.PlaybackControl, ButtonMode.AmbientSoundControl]);
  });

  it('decodes the left and right assignment', () => {
    expect(decodeAssignable(payload(Reply.SystemParam, 0x03, 0x02, 0x10, 0xff))).toEqual({
      left: ButtonMode.VolumeControl,
      right: ButtonMode.NoFunction,
    });
  });

  it('rejects a body whose count byte is not 0x02', () => {
    // The count is what tells the two-value shape from other assignable
    // payloads; reading past it would misattribute bytes.
    expect(() => decodeAssignable(payload(Reply.SystemParam, 0x03, 0x01, 0x10, 0xff))).toThrow();
  });

  it('rejects mode bytes outside the enum', () => {
    expect(() => decodeAssignable(payload(Reply.SystemParam, 0x03, 0x02, 0x77, 0x00))).toThrow();
  });

  it('recognises its own replies among the system family', () => {
    expect(isAssignableReply(payload(Reply.SystemParamNotify, 0x03, 0x02, 0x10, 0x10))).toBe(true);
    expect(isAssignableReply(payload(Reply.SystemParamNotify, 0x0c, 0x00))).toBe(false);
  });
});

describe('the offered mode list', () => {
  it('decodes 0x35 without offering it as a choice', () => {
    // A device can report AMBIENT_SOUND_CONTROL_QUICK_ACCESS, so it must
    // decode; but it is the same logical mode as 0x00 with a byte chosen by
    // capability, so it is not a second thing to pick.
    expect(decodeAssignable(payload(Reply.SystemParam, 0x03, 0x02, 0x35, 0x35))).toEqual({
      left: 0x35,
      right: 0x35,
    });
    expect(BUTTON_MODE_OPTIONS.map((option) => option.value)).not.toContain(0x35);
  });

  it('offers only modes it can also encode', () => {
    for (const option of BUTTON_MODE_OPTIONS) {
      expect(() => encodeSetAssignable(option.value, option.value)).not.toThrow();
    }
  });
});

