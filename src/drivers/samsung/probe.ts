import type { ProtocolProbe } from '@/core/identify';
import { FrameDecoder, encodeFrame } from './frame';
import { MsgId } from './ids';

/**
 * Recognising Galaxy Buds on a shared port: any whole `FD … DD` frame whose
 * CRC-16 checks out. The CRC is what makes this safe to run over another
 * protocol's bytes — a stray 0xFD that happens to sit where a length belongs
 * still has a one-in-65536 chance of passing, per candidate frame.
 *
 * The question it asks a silent device is `DebugSku`, a read the earbuds
 * answer on every model that has one. Not the 2019 Buds, which never arrive
 * here: they have a service of their own.
 */
export const samsungProbe: ProtocolProbe = {
  recognises: (heard) => new FrameDecoder().push(heard).length > 0,
  query: encodeFrame(MsgId.DebugSku),
};
