import { describe, expect, it } from 'vitest';

import { Command, Reply } from './commands';
import {
  SPEAK_TO_CHAT_SENSITIVITY_OPTIONS,
  SPEAK_TO_CHAT_TIMEOUT_OPTIONS,
  SpeakToChatSensitivity,
  SpeakToChatTimeout,
  decodeSpeakToChatConfig,
  decodeSpeakToChatEnabled,
  encodeGetSpeakToChatConfig,
  encodeGetSpeakToChatEnabled,
  encodeSetSpeakToChatConfig,
  encodeSetSpeakToChatEnabled,
  speakToChatInquiryFor,
} from './speakToChat';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);

describe('speakToChatInquiryFor', () => {
  it('maps the Type-2 capability onto the 0x0c system inquiry', () => {
    expect(speakToChatInquiryFor(new Set([0xfc]))).toBe(0x0c);
  });

  it('ignores the Type-1 capability, whose wire shape we have no evidence for', () => {
    // 0xf2 is the older speak-to-chat; BudsLink implements none of it and the
    // decompile only names it. Claiming it without bytes would be a guess.
    expect(speakToChatInquiryFor(new Set([0xf2]))).toBeNull();
    expect(speakToChatInquiryFor(new Set([0x61, 0x66]))).toBeNull();
  });
});

describe('enabled (SYSTEM param 0x0c)', () => {
  it('reads with the plain system-param form', () => {
    expect(encodeGetSpeakToChatEnabled()).toEqual([Command.GetSystemParam, 0x0c]);
  });

  it('writes on as 0x00 with the trailing changed byte, off as 0x01', () => {
    // The on/off byte is inverted like every SYSTEM toggle — see
    // `OnOffSettingValue`. Type-2 carries one more byte than the simple
    // toggles: the value-change status, always Changed from a controller.
    expect(encodeSetSpeakToChatEnabled(true)).toEqual([Command.SetSystemParam, 0x0c, 0x00, 0x01]);
    expect(encodeSetSpeakToChatEnabled(false)).toEqual([Command.SetSystemParam, 0x0c, 0x01, 0x01]);
  });

  it('decodes a reply with or without the trailing status byte', () => {
    expect(decodeSpeakToChatEnabled(payload(Reply.SystemParam, 0x0c, 0x00))).toBe(true);
    expect(decodeSpeakToChatEnabled(payload(Reply.SystemParam, 0x0c, 0x01, 0x01))).toBe(false);
  });

  it('rejects a body for another system setting', () => {
    expect(() => decodeSpeakToChatEnabled(payload(Reply.SystemParam, 0x01, 0x00))).toThrow();
  });
});

describe('config (SYSTEM extended param 0x0c)', () => {
  it('reads and writes through the extended-param opcodes', () => {
    expect(encodeGetSpeakToChatConfig()).toEqual([0xfa, 0x0c]);
    expect(encodeSetSpeakToChatConfig(SpeakToChatSensitivity.High, SpeakToChatTimeout.Long)).toEqual([
      0xfc, 0x0c, SpeakToChatSensitivity.High, SpeakToChatTimeout.Long,
    ]);
  });

  it('decodes sensitivity and timeout off the reply', () => {
    const decoded = decodeSpeakToChatConfig(payload(0xfb, 0x0c, 0x00, 0x01));
    expect(decoded).toEqual({ sensitivity: SpeakToChatSensitivity.Auto, timeout: SpeakToChatTimeout.Standard });
  });

  it('rejects bytes outside both enums', () => {
    // A wrong byte here labels a menu wrong forever; better to keep null and
    // let the refresh retry than to render nonsense.
    expect(() => decodeSpeakToChatConfig(payload(0xfb, 0x0c, 0x7f, 0x00))).toThrow();
    expect(() => decodeSpeakToChatConfig(payload(0xfb, 0x0c, 0x00, 0x7f))).toThrow();
  });

  it('offers every sensitivity and timeout the device can hold', () => {
    expect(SPEAK_TO_CHAT_SENSITIVITY_OPTIONS.map((o) => o.value)).toEqual([
      SpeakToChatSensitivity.Auto, SpeakToChatSensitivity.High, SpeakToChatSensitivity.Low,
    ]);
    expect(SPEAK_TO_CHAT_TIMEOUT_OPTIONS.map((o) => o.value)).toEqual([
      SpeakToChatTimeout.Short, SpeakToChatTimeout.Standard, SpeakToChatTimeout.Long, SpeakToChatTimeout.Off,
    ]);
  });
});
