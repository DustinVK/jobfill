/**
 * Typed request/response protocol between the background DataService and every other
 * context (SPEC §8.3). Handlers validate payloads: content scripts run in hostile pages,
 * so nothing that arrives over this channel is trusted.
 *
 * Rung 0 ships the envelope plus `ping`; the vault operations land in Rung 1.
 */
import type { MessageTransport } from './adapters/types.js';

/** Payload-free requests: `{ t }` only. */
export type NoPayload = Record<never, never>;

export interface ProtocolMap {
  ping: { req: NoPayload; res: { pong: true; version: string } };
}

export type MessageType = keyof ProtocolMap;
export type RequestOf<K extends MessageType> = { t: K } & ProtocolMap[K]['req'];
export type ResponseOf<K extends MessageType> = ProtocolMap[K]['res'];
export type AnyRequest = { [K in MessageType]: RequestOf<K> }[MessageType];

/** Wire envelope: errors cross the boundary as data, never as rejected promises. */
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export function isRequest(value: unknown): value is AnyRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    't' in value &&
    typeof (value as { t: unknown }).t === 'string'
  );
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

/** Typed client over any transport. Throws on a failed envelope or a malformed reply. */
export class ProtocolClient {
  constructor(private readonly transport: MessageTransport) {}

  async send<K extends MessageType>(request: RequestOf<K>): Promise<ResponseOf<K>> {
    const reply = await this.transport.send(request);
    if (!isEnvelope(reply)) {
      throw new Error(`jobfill: malformed reply to "${request.t}"`);
    }
    if (!reply.ok) throw new Error(reply.error);
    return reply.data as ResponseOf<K>;
  }
}
