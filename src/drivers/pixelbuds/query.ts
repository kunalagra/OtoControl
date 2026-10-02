/**
 * The read-only RPCs the System tab's query box will send. A deliberately
 * short list: nothing typed there can change a setting.
 */

import { encodeReadSetting, Method } from './maestro';

export interface Query {
  method: string;
  payload: Uint8Array;
}

export const QUERY_HELP = 'software, hardware, or read <setting id>, e.g. read 13';

/** Parses `software`, `hardware` or `read <id>`; returns an error string for anything else. */
export function parseQuery(text: string): Query | string {
  const [word, argument, ...rest] = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (rest.length > 0) return `Enter ${QUERY_HELP}`;
  if (word === 'software' && argument === undefined) return { method: Method.GetSoftwareInfo, payload: new Uint8Array(0) };
  if (word === 'hardware' && argument === undefined) return { method: Method.GetHardwareInfo, payload: new Uint8Array(0) };
  if (word === 'read' && argument !== undefined && /^\d{1,3}$/.test(argument)) {
    return { method: Method.ReadSetting, payload: encodeReadSetting(Number(argument)) };
  }
  return `Enter ${QUERY_HELP}`;
}
