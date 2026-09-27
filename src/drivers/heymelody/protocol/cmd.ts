/** Command ids (realme `Protocol.java`, HeyTap `OppoProtocol` index). Replies are `cmd | 0x8000`. */
export const Cmd = {
  QueryCapability: 0x0100,
  QueryProductId: 0x0103,
  QueryVersion: 0x0105,
  Battery: 0x0106,
  QueryWear: 0x0109,
  QueryColourId: 0x010b,
  QueryAncDirect: 0x010c,
  QueryEqCurrent: 0x010f,
  QueryEqAll: 0x0122,
  QueryNotificationSupport: 0x0200,
  ActiveReport: 0x0204,
  RegisterNotify: 0x0205,
  FindEarbuds: 0x0400,
  SetAncMode: 0x0404,
  SetEqPreset: 0x0406,
  SetEqCurve: 0x0418,
  PushEqCurrent: 0x0504,
  PushEqCurves: 0x0506,
} as const;

export const replyFor = (cmd: number): number => cmd | 0x8000;
