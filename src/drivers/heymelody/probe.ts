import type { ProtocolProbe } from '@/core/identify';
import { Cmd, replyFor } from './protocol/cmd';
import { SppFrameDecoder, encodeSppFrame } from './sppFrame';

/**
 * Recognising HeyMelody on a shared port: an `0xAA` frame whose own length
 * field agrees with the bytes it carries and whose command is the reply to the
 * capability query below (`0x8100`). Nothing else counts — HeyMelody earbuds
 * do not speak first, so this is only ever an answer.
 *
 * Earbuds whose firmware never answers `0x0100` (it is optional, see
 * `HeyMelodyDevice`'s probing fallback) are not recognised here; the manager
 * hands an unrecognised port to HeyMelody anyway, which is what it always did
 * with this service.
 */
export const heymelodyProbe: ProtocolProbe = {
  recognises: (heard) =>
    new SppFrameDecoder().push(heard).some((frame) => frame.lengthOk && frame.cmd === replyFor(Cmd.QueryCapability)),
  query: encodeSppFrame(Cmd.QueryCapability, 1),
};
