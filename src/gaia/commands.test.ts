import { describe, expect, it } from 'vitest';

import {
  ANTI_WIND_OPTIONS,
  AUDIO_MODE_OPTIONS,
  AudioMode,
  AncMode,
  AntiWind,
  WearState,
  connectPairedDevice,
  disconnectPairedDevice,
  POWER_OFF_PRESETS,
  Timer,
  codecName,
  formatDuration,
  formatVersion,
  getAncEnabled,
  getAncModes,
  getAudioMode,
  getAudioPromptMode,
  getBattery,
  getConnectionStatus,
  getModelId,
  getPairedDevice,
  getPairedDeviceCount,
  getSerialNumber,
  getSystemVersion,
  getTimer,
  getTouchControls,
  getTransparencyLevel,
  setAncEnabled,
  setAncMode,
  setAudioMode,
  setSidetone,
  setTimer,
  setTouchControls,
  setTransparencyLevel,
  wearStateName,
} from './commands';
import { Vendor, encodeFrame, toHex } from './frame';
import { SUBSCRIBED_FEATURES, SennheiserFeature, featureOf } from './features';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);

describe('status decoders (hardware-captured payloads)', () => {
  it('decodes the battery response as 70%', () => {
    expect(getBattery.decode(payload(0x46))).toEqual([70]);
  });

  it('decodes the NUL-padded model string', () => {
    const raw = payload(0x4d, 0x34, 0x41, 0x45, 0x42, 0x54, 0x20, 0x42, 0x6c, 0x61, 0x63, 0x6b, 0x00);
    expect(getModelId.decode(raw)).toBe('M4AEBT Black');
  });

  it('decodes ANC enabled', () => {
    expect(getAncEnabled.decode(payload(0x01))).toBe(true);
    expect(getAncEnabled.decode(payload(0x00))).toBe(false);
  });

  it('decodes the transparency level', () => {
    expect(getTransparencyLevel.decode(payload(0x50))).toBe(80);
  });

  it('decodes the six-byte ANC mode payload', () => {
    expect(getAncModes.decode(payload(0x01, 0x01, 0x02, 0x00, 0x03, 0x00))).toEqual({
      antiWind: 1,
      comfort: 0,
      adaptive: 0,
    });
  });

  it('tolerates ANC mode pairs in any order and keeps the auto state', () => {
    expect(getAncModes.decode(payload(0x03, 0x01, 0x01, 0x02))).toEqual({
      antiWind: 2,
      comfort: 0,
      adaptive: 1,
    });
  });

  it('throws rather than inventing a value for an empty payload', () => {
    expect(() => getTransparencyLevel.decode(payload())).toThrow();
  });
});

describe('command routing', () => {
  it('sends the serial number request to the Qualcomm vendor, not Sennheiser', () => {
    expect(getSerialNumber.vendor).toBe(Vendor.Qualcomm);
    expect(getBattery.vendor).toBe(Vendor.Sennheiser);
  });

  it('encodes a full set-transparency frame', () => {
    const frame = encodeFrame(
      setTransparencyLevel.vendor,
      setTransparencyLevel.id,
      setTransparencyLevel.encode(80),
    );
    expect(toHex(frame)).toBe('FF 03 00 01 04 95 1A 02 50');
  });
});

describe('touch controls (inverted on the wire)', () => {
  it('reports touch controls as on when the auto-lock is off', () => {
    expect(getTouchControls.decode(payload(0x00))).toBe(true);
    expect(getTouchControls.decode(payload(0x01))).toBe(false);
  });

  it('sends the lock value, not the label value', () => {
    expect(setTouchControls.encode(true)).toEqual([0]);
    expect(setTouchControls.encode(false)).toEqual([1]);
  });

  it('round-trips both ways', () => {
    for (const enabled of [true, false]) {
      const [wire] = setTouchControls.encode(enabled);
      expect(getTouchControls.decode(payload(wire))).toBe(enabled);
    }
  });
});

describe('paired devices', () => {
  it('decodes a device entry with a NUL-terminated name', () => {
    const raw = payload(1, 2, 1, 0x50, 0x69, 0x78, 0x65, 0x6c, 0x00);
    expect(getPairedDevice.decode(raw)).toEqual({
      index: 1,
      priority: 2,
      connected: true,
      name: 'Pixel',
    });
  });

  it('handles an entry with an empty name', () => {
    expect(getPairedDevice.decode(payload(0, 0, 0))).toEqual({
      index: 0,
      priority: 0,
      connected: false,
      name: '',
    });
  });

  it('decodes the list size as a big-endian u16', () => {
    expect(getPairedDeviceCount.decode(payload(0x00, 0x03))).toBe(3);
  });

  it('decodes a connection status', () => {
    expect(getConnectionStatus.decode(payload(2, 1))).toEqual({ index: 2, connected: true });
  });

  it('addresses connect and disconnect by index', () => {
    expect(connectPairedDevice.encode(2)).toEqual([2]);
    expect(disconnectPairedDevice.encode(2)).toEqual([2]);
    expect(connectPairedDevice.id).not.toBe(disconnectPairedDevice.id);
  });
});

describe('anti-wind (three-state, not a toggle)', () => {
  it('offers exactly the values the app config lists', () => {
    expect(ANTI_WIND_OPTIONS.map((o) => o.label)).toEqual(['Off', 'Max', 'Auto']);
    expect(ANTI_WIND_OPTIONS.map((o) => o.value)).toEqual([
      AntiWind.Off,
      AntiWind.Max,
      AntiWind.Auto,
    ]);
  });

  it('encodes each value as an ANC mode pair', () => {
    for (const { value } of ANTI_WIND_OPTIONS) {
      expect(setAncMode.encode({ mode: AncMode.AntiWind, state: value })).toEqual([1, value]);
    }
  });

  it('decodes auto from the ANC modes payload', () => {
    expect(getAncModes.decode(payload(0x01, 0x02, 0x02, 0x00, 0x03, 0x00)).antiWind).toBe(
      AntiWind.Auto,
    );
  });
});

describe('sound mode (audio mode)', () => {
  it('uses the IDs BudsLink documents, not the audio-prompt pair', () => {
    // 0x0801/0x0802 are voice prompts; sound mode is a separate command.
    expect(getAudioMode.id).toBe(0x0804);
    expect(setAudioMode.id).toBe(0x0803);
    expect(getAudioMode.id).not.toBe(getAudioPromptMode.id);
  });

  it('offers the four modes from the M4 config', () => {
    expect(AUDIO_MODE_OPTIONS.map((o) => o.value)).toEqual([
      AudioMode.Off,
      AudioMode.Equalizer,
      AudioMode.Podcast,
      AudioMode.Personalized,
    ]);
  });

  it('round-trips each mode', () => {
    for (const { value } of AUDIO_MODE_OPTIONS) {
      expect(getAudioMode.decode(payload(value))).toBe(value);
      expect(setAudioMode.encode(value)).toEqual([value]);
    }
  });

  it('belongs to a subscribed feature, so mode changes push', () => {
    expect(featureOf(getAudioMode.id)).toBe(SennheiserFeature.GenericAudio);
    expect(SUBSCRIBED_FEATURES).toContain(SennheiserFeature.GenericAudio);
  });
});

describe('auto power off presets', () => {
  it('offers only the durations this model accepts', () => {
    // BudsLink MomentumWireless4: autoPowerOff [0, 15, 30, 60] minutes.
    expect(POWER_OFF_PRESETS.map((p) => p.seconds / 60)).toEqual([0, 15, 30, 60]);
  });
});

describe('setter encoders', () => {
  it('encodes booleans as a single byte', () => {
    expect(setAncEnabled.encode(true)).toEqual([1]);
    expect(setAncEnabled.encode(false)).toEqual([0]);
  });

  it('encodes an ANC mode as a [mode, state] pair', () => {
    expect(setAncMode.encode({ mode: AncMode.Adaptive, state: 1 })).toEqual([3, 1]);
  });

  it('clamps transparency into 0–100 instead of sending a wrapped byte', () => {
    expect(setTransparencyLevel.encode(140)).toEqual([100]);
    expect(setTransparencyLevel.encode(-5)).toEqual([0]);
    expect(setTransparencyLevel.encode(62.6)).toEqual([63]);
  });

  it('clamps sidetone into 0–5', () => {
    expect(setSidetone.encode(9)).toEqual([5]);
    expect(setSidetone.encode(-1)).toEqual([0]);
  });
});

describe('system version', () => {
  it('decodes three big-endian u16s', () => {
    expect(getSystemVersion.decode(payload(0, 2, 0, 13, 0, 28))).toEqual([2, 13, 28]);
  });

  it('reads 0x1201, not the 0x1202 build array that decoded as "806.768.0"', () => {
    expect(getSystemVersion.id).toBe(0x1201);
  });

  it('rejects a short payload', () => {
    expect(() => getSystemVersion.decode(payload(0, 2, 0, 13))).toThrow();
  });
});

describe('auto power off timer', () => {
  it('encodes the timer ID and a big-endian u16 duration', () => {
    expect(setTimer.encode({ timer: Timer.PowerOff, seconds: 3600 })).toEqual([0, 0x0e, 0x10]);
  });

  it('clamps a duration that would overflow the u16', () => {
    expect(setTimer.encode({ timer: Timer.PowerOff, seconds: 999_999 })).toEqual([
      0, 0xff, 0xff,
    ]);
  });

  it('encodes the get request as the timer ID alone', () => {
    expect(getTimer.encode(Timer.PowerOff)).toEqual([0]);
  });

  it('decodes the timer number and duration', () => {
    expect(getTimer.decode(payload(0x00, 0x0e, 0x10))).toEqual({ timer: 0, seconds: 3600 });
  });

  it('rejects a short response rather than reporting a wrong duration', () => {
    expect(() => getTimer.decode(payload(0x00, 0x0e))).toThrow();
  });

  it('offers a preset for every duration it can round-trip', () => {
    for (const { seconds } of POWER_OFF_PRESETS) {
      const [timer, hi, lo] = setTimer.encode({ timer: Timer.PowerOff, seconds });
      expect(getTimer.decode(payload(timer, hi, lo))).toEqual({ timer: 0, seconds });
    }
  });
});

describe('formatters', () => {
  it('formats durations for the power-off dropdown', () => {
    expect(formatDuration(0)).toBe('Never');
    expect(formatDuration(3600)).toBe('1 hour');
    expect(formatDuration(7200)).toBe('2 hours');
    expect(formatDuration(900)).toBe('15 minutes');
  });

  it('formats a version triple', () => {
    expect(formatVersion([2, 13, 28])).toBe('2.13.28');
  });

  it('names codecs from the m4.json enum', () => {
    expect(codecName(0)).toBe('SBC');
    expect(codecName(1)).toBe('AAC');
    expect(codecName(8)).toBe('aptX Adaptive');
    expect(codecName(255)).toBe('None');
    expect(codecName(99)).toBe('Codec 99');
  });

  it('names wear states', () => {
    expect(wearStateName(WearState.OnHead)).toBe('On head');
    expect(wearStateName(WearState.InCase)).toBe('In case');
  });
});
