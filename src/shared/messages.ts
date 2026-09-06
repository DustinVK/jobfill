/**
 * Typed request/response protocol between the background DataService and every other
 * context (SPEC §8.3). Handlers validate payloads: content scripts run in hostile pages,
 * so nothing that arrives over this channel is trusted.
 */
import type { MessageTransport } from './adapters/types.js';
import type { ComposeOpts, ComposedValue } from './compose.js';
import type {
  AnswerEntry,
  CanonicalKey,
  Certification,
  Education,
  InterchangeDocument,
  Profile,
  Project,
  ResumeVersion,
  Settings,
  StoredFile,
  StoredFileKind,
  Vault,
  WorkExperience,
} from './types.js';
import type { ImportSummary } from './interchange.js';

/** Payload-free requests: `{ t }` only. */
export type NoPayload = Record<never, never>;

// ---------------------------------------------------------------------------
// Patch operations (section-grained vault updates from the options app)
// ---------------------------------------------------------------------------

/**
 * SPEC §8.3 names `vault.patch(ops)`; tonight's ops are typed section replacements rather
 * than a generic JSON-patch — every write stays a validated, whole-section swap
 * (documented as a Decision in PROGRESS.md).
 */
export type PatchOp =
  | { section: 'profile'; value: Profile }
  | { section: 'work'; value: WorkExperience[] }
  | { section: 'education'; value: Education[] }
  | { section: 'projects'; value: Project[] }
  | { section: 'certifications'; value: Certification[] }
  | { section: 'answers'; value: AnswerEntry[] }
  | { section: 'versions'; value: ResumeVersion[] }
  | { section: 'settings'; value: Settings };

export const PATCHABLE_SECTIONS = [
  'profile',
  'work',
  'education',
  'projects',
  'certifications',
  'answers',
  'versions',
  'settings',
] as const;

export interface SearchResult {
  /** Snippet / answer / atom id. */
  id: string;
  /** What kind of thing this is, for palette display. */
  kind: 'snippet' | 'answer' | 'atom';
  /** Display label ("Led CI migration", "Sponsorship"). */
  label: string;
  /** The text that would fill. */
  value: string;
  /** Canonical key when the result maps to one (atoms, well-known answers). */
  key?: CanonicalKey;
  sensitive: boolean;
}

// ---------------------------------------------------------------------------
// The protocol map
// ---------------------------------------------------------------------------

export interface ProtocolMap {
  ping: { req: NoPayload; res: { pong: true; version: string } };

  'vault.get': { req: NoPayload; res: { vault: Vault } };
  'vault.patch': { req: { ops: PatchOp[] }; res: { vault: Vault } };
  'vault.wipe': { req: { confirm: 'wipe' }; res: { vault: Vault } };
  'vault.export': { req: NoPayload; res: { document: InterchangeDocument } };
  'vault.import': {
    req: { document: InterchangeDocument };
    res: { vault: Vault; summary: ImportSummary };
  };

  'version.list': {
    req: NoPayload;
    res: { versions: ResumeVersion[]; activeVersionId: string };
  };
  'version.setActive': { req: { id: string }; res: { activeVersionId: string } };

  compose: { req: { key: CanonicalKey; opts?: ComposeOpts }; res: ComposedValue };
  /** Everything the content-side classifier needs, in one round-trip per scan generation. */
  'fill.context': {
    req: NoPayload;
    res: {
      answers: Pick<AnswerEntry, 'id' | 'key' | 'question' | 'patterns' | 'sensitive'>[];
      fillAllThreshold: number;
      suggestThreshold: number;
      activeVersionName: string;
    };
  };
  'snippets.search': {
    req: { q: string; scope?: 'all' | 'answers'; limit?: number };
    res: { results: SearchResult[] };
  };

  'file.list': { req: NoPayload; res: { files: StoredFile[] } };
  'file.add': {
    req: { kind: StoredFileKind; name: string; mime: string; bytes: ArrayBuffer };
    res: { file: StoredFile };
  };
  'file.get': { req: { fileId: string }; res: { file: File } };
  'file.delete': { req: { fileId: string }; res: { files: StoredFile[] } };
}

export type MessageType = keyof ProtocolMap;
export type RequestOf<K extends MessageType> = { t: K } & ProtocolMap[K]['req'];
export type ResponseOf<K extends MessageType> = ProtocolMap[K]['res'];
export type AnyRequest = { [K in MessageType]: RequestOf<K> }[MessageType];

/** Wire envelope: errors cross the boundary as data, never as rejected promises. */
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

export function isRequest(value: unknown): value is { t: string } & Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    't' in value &&
    typeof (value as { t: unknown }).t === 'string'
  );
}

// ---------------------------------------------------------------------------
// Payload validation helpers (used by the background router)
// ---------------------------------------------------------------------------

export function expectString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`jobfill: "${name}" must be a string`);
  return value;
}

export function expectNonEmptyString(value: unknown, name: string): string {
  const str = expectString(value, name);
  if (str.length === 0) throw new Error(`jobfill: "${name}" must not be empty`);
  return str;
}

export function expectArrayBuffer(value: unknown, name: string): ArrayBuffer {
  if (!(value instanceof ArrayBuffer)) throw new Error(`jobfill: "${name}" must be an ArrayBuffer`);
  return value;
}

export function expectObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`jobfill: "${name}" must be an object`);
  }
  return value as Record<string, unknown>;
}

export function expectPatchOps(value: unknown): PatchOp[] {
  if (!Array.isArray(value)) throw new Error('jobfill: "ops" must be an array');
  for (const op of value) {
    const obj = expectObject(op, 'ops[]');
    const section = obj.section;
    if (
      typeof section !== 'string' ||
      !(PATCHABLE_SECTIONS as readonly string[]).includes(section)
    ) {
      throw new Error(`jobfill: unknown patch section "${String(section)}"`);
    }
    if (!('value' in obj)) throw new Error('jobfill: patch op missing "value"');
    const mustBeArray = section !== 'profile' && section !== 'settings';
    if (mustBeArray && !Array.isArray(obj.value)) {
      throw new Error(`jobfill: patch section "${section}" expects an array value`);
    }
    if (!mustBeArray) expectObject(obj.value, `${section} value`);
  }
  return value as PatchOp[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

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
