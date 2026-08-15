/**
 * The connection lifecycle, shared by every driver.
 *
 * This is one of the few vocabulary items that is genuinely brand-agnostic: a
 * session, a Sony device and a Sennheiser device all report the same four
 * states, and the UI renders them identically. It lives in `core/` so that no
 * driver has to import another driver's state module to name them.
 */

export type ConnectionStatus =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected';
