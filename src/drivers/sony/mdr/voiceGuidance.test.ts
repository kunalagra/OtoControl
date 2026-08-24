import { describe, expect, it } from 'vitest';

import {
  VOICE_GUIDANCE_GET,
  VOICE_GUIDANCE_RET,
  VOICE_GUIDANCE_SET,
  VOICE_GUIDANCE_NOTIFY,
  decodeVoiceGuidance,
  decodeVoiceGuidanceVolume,
  encodeGetVoiceGuidance,
  encodeGetVoiceGuidanceVolume,
  encodeSetVoiceGuidance,
  encodeSetVoiceGuidanceVolume,
  isVoiceGuidanceReply,
  isVoiceGuidanceVolumeReply,
} from './voiceGuidance';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);

describe('voice guidance opcodes', () => {
  it('keeps the GET/RET/SET/NTFY grouping of the second table', () => {
    expect(VOICE_GUIDANCE_GET).toBe(0x46);
    expect(VOICE_GUIDANCE_RET).toBe(0x47);
    expect(VOICE_GUIDANCE_SET).toBe(0x48);
    expect(VOICE_GUIDANCE_NOTIFY).toBe(0x49);
  });
});

describe('voice guidance on/off (selector 0x03)', () => {
  it('reads and writes the disable byte inverted, like every Sony toggle', () => {
    expect(encodeGetVoiceGuidance()).toEqual([0x46, 0x03]);
    expect(encodeSetVoiceGuidance(true)).toEqual([0x48, 0x03, 0x00]);
    expect(encodeSetVoiceGuidance(false)).toEqual([0x48, 0x03, 0x01]);
  });

  it('decodes the reply, tolerating the extra trailing byte', () => {
    expect(decodeVoiceGuidance(payload(0x47, 0x03, 0x00, 0x00))).toBe(true);
    expect(decodeVoiceGuidance(payload(0x47, 0x03, 0x01, 0x00))).toBe(false);
  });

  it('rejects other selectors', () => {
    expect(() => decodeVoiceGuidance(payload(0x47, 0x20, 0x00))).toThrow();
  });
});

describe('voice guidance volume (selector 0x20)', () => {
  it('encodes negative levels as two’s complement', () => {
    expect(encodeSetVoiceGuidanceVolume(2)).toEqual([0x48, 0x20, 0x02]);
    expect(encodeSetVoiceGuidanceVolume(-2)).toEqual([0x48, 0x20, 0xfe]);
  });

  it('decodes the signed byte and rejects values outside -2…2', () => {
    expect(encodeGetVoiceGuidanceVolume()).toEqual([0x46, 0x20]);
    expect(decodeVoiceGuidanceVolume(payload(0x47, 0x20, 0xfe))).toBe(-2);
    expect(decodeVoiceGuidanceVolume(payload(0x47, 0x20, 0x02))).toBe(2);
    expect(() => decodeVoiceGuidanceVolume(payload(0x47, 0x20, 0x05))).toThrow();
  });

  it('refuses to encode a level the device does not offer', () => {
    expect(() => encodeSetVoiceGuidanceVolume(3)).toThrow();
    expect(() => encodeSetVoiceGuidanceVolume(-3)).toThrow();
  });
});

describe('reply recognition', () => {
  it('tells the two selectors apart on both reply opcodes', () => {
    expect(isVoiceGuidanceReply(payload(0x47, 0x03, 0x00))).toBe(true);
    expect(isVoiceGuidanceReply(payload(0x49, 0x03, 0x00))).toBe(true);
    expect(isVoiceGuidanceReply(payload(0x47, 0x20, 0x00))).toBe(false);
    expect(isVoiceGuidanceVolumeReply(payload(0x49, 0x20, 0x01))).toBe(true);
    expect(isVoiceGuidanceVolumeReply(payload(0x49, 0x03, 0x01))).toBe(false);
  });
});
