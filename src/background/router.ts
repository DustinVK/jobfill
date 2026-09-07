/**
 * Message router: the single entry into background state (SPEC §6.1, §8.3).
 * Adapter-agnostic — `index.ts` gives it the real environment, tests give it the memory one.
 * Every handler validates its payload before touching the DataService; content scripts run
 * in hostile pages, so nothing arriving here is trusted.
 */
import type { BackgroundEnv, MessageHandler, MessageSender } from '../shared/adapters/types.js';
import type { Envelope } from '../shared/messages.js';
import {
  expectArrayBuffer,
  expectNonEmptyString,
  expectObject,
  expectPatchOps,
  isRequest,
} from '../shared/messages.js';
import type { ComposeOpts } from '../shared/compose.js';
import { compose } from '../shared/compose.js';
import { DATE_FORMATS, PHONE_FORMATS, RENDERERS } from '../shared/format.js';
import { buildSearchIndex, searchIndex } from '../shared/search.js';
import type { InterchangeDocument, StoredFile, StoredFileKind, Vault } from '../shared/types.js';
import { validateImport, formatValidationErrors } from '../shared/validate-import.js';
import { DataService } from './data-service.js';
import { FileStore } from './file-store.js';

// Injected by esbuild from manifest.json (scripts/build.mjs `define`); the fallback keeps
// vitest (which imports this file without the build step) working.
declare const __JOBFILL_VERSION__: string | undefined;
export const EXTENSION_VERSION =
  typeof __JOBFILL_VERSION__ === 'string' ? __JOBFILL_VERSION__ : 'dev';

export interface RouterDeps {
  env: BackgroundEnv;
  /** Injectable for tests; defaults to real services over the env's adapters. */
  data?: DataService;
  files?: FileStore;
}

const FILE_KINDS: readonly StoredFileKind[] = ['resume', 'coverLetter', 'other'];

/** Sanity cap for uploads — a resume PDF is <5 MB; anything huge wedges storage. */
const MAX_FILE_BYTES = 25 * 1_048_576;

/**
 * Requests that expose or mutate the whole vault. Only extension contexts (options, popup,
 * background — origin `moz-extension:` or absent) may issue them; content scripts running in
 * web pages get the narrow fill-time surface only (SPEC §8.3: vault.get is a redacted slice
 * for content — tonight the slice for web contexts is "nothing", which is stricter).
 */
const PRIVILEGED_TYPES = new Set([
  // version.setActive is deliberately NOT privileged: the fill bar's inline version
  // switcher (SPEC §3.3) runs in the content script; the handler only selects among
  // existing validated version ids and exposes nothing.
  'vault.get',
  'vault.patch',
  'vault.wipe',
  'vault.export',
  'vault.import',
  'file.add',
  'file.delete',
  'file.list',
]);

function isPrivilegedSender(sender: MessageSender): boolean {
  if (sender.origin === undefined) return true; // extension pages under structured-clone messaging
  return sender.origin.startsWith('moz-extension:');
}

export function createRouter(deps: RouterDeps): MessageHandler {
  const files = deps.files ?? new FileStore(deps.env.blobs);
  const data = deps.data ?? new DataService(deps.env.storage, files);

  return async (message: unknown, sender: MessageSender): Promise<Envelope<unknown>> => {
    if (!isRequest(message)) {
      return { ok: false, error: 'jobfill: malformed request' };
    }
    if (PRIVILEGED_TYPES.has(message.t) && !isPrivilegedSender(sender)) {
      return {
        ok: false,
        error: `jobfill: "${message.t}" is not available to content scripts`,
      };
    }
    try {
      return { ok: true, data: await handle(message, data, files, sender, deps.env) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/** The file the fill bar is currently offered (version-linked, else the sole resume). */
function offeredAttachFile(vault: Vault): StoredFile | undefined {
  const active = vault.versions.find((v) => v.id === vault.settings.activeVersionId);
  const linked = active?.fileId ? vault.files.find((f) => f.id === active.fileId) : undefined;
  const resumes = vault.files.filter((f) => f.kind === 'resume');
  return linked ?? (resumes.length === 1 ? resumes[0] : undefined);
}

/**
 * True when the vault holds anything jobfill could actually fill with. A fresh install has
 * an auto-created default version but no atoms — the overlay uses this to prompt "import
 * your data" instead of silently offering nothing (on-device Android finding).
 */
function vaultHasFillableData(vault: Vault): boolean {
  const p = vault.profile;
  return Boolean(
    p.identity.firstName ||
    p.identity.lastName ||
    p.contact.email ||
    p.contact.phone?.national ||
    p.skills.length ||
    vault.work.length ||
    vault.education.length ||
    vault.answers.length ||
    vault.files.length,
  );
}

async function handle(
  message: { t: string } & Record<string, unknown>,
  data: DataService,
  files: FileStore,
  sender: MessageSender,
  env: BackgroundEnv,
): Promise<unknown> {
  switch (message.t) {
    case 'ping':
      return { pong: true, version: EXTENSION_VERSION };

    case 'options.open':
      await env.runtime.openOptionsPage();
      return { ok: true };

    // --- vault --------------------------------------------------------------
    case 'vault.get':
      return { vault: await data.getVault() };

    case 'vault.patch':
      return { vault: await data.patch(expectPatchOps(message.ops)) };

    case 'vault.wipe': {
      if (message.confirm !== 'wipe') {
        throw new Error('jobfill: wipe requires confirm: "wipe"');
      }
      return { vault: await data.wipe() };
    }

    case 'vault.export':
      return { document: await data.export() };

    case 'vault.import': {
      const raw = expectObject(message.document, 'document');
      // Defense in depth: the options page validates before sending, but re-validate here —
      // this handler is reachable by any extension context.
      const validation = validateImport(raw);
      if (!validation.valid) {
        throw new Error(
          `jobfill: import failed validation:\n${formatValidationErrors(validation.errors)}`,
        );
      }
      return data.import(validation.document);
    }

    // --- versions -----------------------------------------------------------
    case 'version.list': {
      const vault = await data.getVault();
      return { versions: vault.versions, activeVersionId: vault.settings.activeVersionId };
    }

    case 'version.setActive':
      return {
        activeVersionId: await data.setActiveVersion(expectNonEmptyString(message.id, 'id')),
      };

    // --- composition & search ----------------------------------------------
    case 'compose': {
      const key = expectNonEmptyString(message.key, 'key');
      const opts = sanitizeComposeOpts(
        message.opts === undefined ? {} : expectObject(message.opts, 'opts'),
      );
      const vault = await data.getVault();
      const value = compose(vault, key, opts);
      if (value === undefined) throw new Error(`jobfill: cannot compose key "${key}"`);
      return value;
    }

    case 'fill.context': {
      const vault = await data.getVault();
      const active = vault.versions.find((v) => v.id === vault.settings.activeVersionId);
      // Attach offer (SPEC §3.7): the version-linked file, else the sole resume on record.
      const attachedFile = offeredAttachFile(vault);
      return {
        answers: vault.answers.map((a) => ({
          id: a.id,
          key: a.key,
          question: a.question,
          patterns: a.patterns,
          sensitive: a.sensitive,
        })),
        hasData: vaultHasFillableData(vault),
        fillAllThreshold: vault.settings.fillAllThreshold,
        suggestThreshold: vault.settings.suggestThreshold,
        activeVersionName: active?.name ?? 'Default',
        versions: vault.versions.map((v) => ({ id: v.id, name: v.name })),
        activeVersionId: vault.settings.activeVersionId,
        ...(attachedFile ? { attachedFile: { id: attachedFile.id, name: attachedFile.name } } : {}),
      };
    }

    case 'answers.quickSave': {
      const question = expectNonEmptyString(message.question, 'question').slice(0, 500);
      const value = expectNonEmptyString(message.value, 'value').slice(0, 5000);
      const vault = await data.getVault();
      if (vault.answers.length >= 500) {
        throw new Error('jobfill: answers bank is full (500 entries) — clean up in options');
      }
      const entry = {
        id: crypto.randomUUID(),
        question,
        patterns: [],
        kind: 'text' as const,
        value,
        sensitive: false,
      };
      await data.patch([{ section: 'answers', value: [...vault.answers, entry] }]);
      return { id: entry.id };
    }

    case 'snippets.search': {
      const q = typeof message.q === 'string' ? message.q : '';
      const scope = message.scope === 'answers' ? 'answers' : 'all';
      const limit =
        typeof message.limit === 'number' && message.limit > 0 && message.limit <= 100
          ? message.limit
          : 20;
      const vault = await data.getVault();
      return { results: searchIndex(buildSearchIndex(vault), q, { scope, limit }) };
    }

    // --- files --------------------------------------------------------------
    case 'file.list': {
      const vault = await data.getVault();
      return { files: vault.files };
    }

    case 'file.add': {
      const kind = expectNonEmptyString(message.kind, 'kind') as StoredFileKind;
      if (!FILE_KINDS.includes(kind)) throw new Error(`jobfill: unknown file kind "${kind}"`);
      const name = expectNonEmptyString(message.name, 'name');
      const mime = expectNonEmptyString(message.mime, 'mime');
      const bytes = expectArrayBuffer(message.bytes, 'bytes');
      if (bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error(
          `jobfill: file is ${Math.round(bytes.byteLength / 1_048_576)} MB — the limit is ${MAX_FILE_BYTES / 1_048_576} MB`,
        );
      }
      const record = await files.add({ kind, name, mime, bytes });
      try {
        await data.addFile(record);
      } catch (err) {
        await files.delete(record).catch(() => undefined); // never orphan the blob
        throw err;
      }
      return { file: record };
    }

    case 'file.get': {
      const fileId = expectNonEmptyString(message.fileId, 'fileId');
      const vault = await data.getVault();
      // Need-to-know for content scripts: only the file the fill bar was offered
      // (rung-3 review P2) — extension pages may fetch any stored file.
      if (!isPrivilegedSender(sender) && offeredAttachFile(vault)?.id !== fileId) {
        throw new Error('jobfill: content pages may only request the offered attach file');
      }
      const record = vault.files.find((f) => f.id === fileId);
      if (!record) throw new Error(`jobfill: no file with id "${fileId}"`);
      const file = await files.getFile(record);
      if (!file) throw new Error(`jobfill: bytes missing for file "${record.name}"`);
      // Firefox structured-clone messaging carries the File object directly (SPEC §6.2).
      return { file };
    }

    case 'file.delete': {
      const fileId = expectNonEmptyString(message.fileId, 'fileId');
      const vault = await data.getVault();
      const record = vault.files.find((f) => f.id === fileId);
      if (record) {
        await files.delete(record);
        await data.removeFile(fileId);
      }
      return { files: (await data.getVault()).files };
    }

    default:
      throw new Error(`jobfill: unknown request "${message.t}"`);
  }
}

/** Compose opts arrive from content scripts — coerce to safe shapes, drop garbage. */
function sanitizeComposeOpts(raw: Record<string, unknown>): ComposeOpts {
  const opts: ComposeOpts = {};
  if (typeof raw.maxLength === 'number' && Number.isFinite(raw.maxLength) && raw.maxLength > 0) {
    opts.maxLength = Math.floor(raw.maxLength);
  }
  if (typeof raw.multiline === 'boolean') opts.multiline = raw.multiline;
  if (typeof raw.rows === 'number' && Number.isFinite(raw.rows)) opts.rows = raw.rows;
  if (typeof raw.renderer === 'string' && (RENDERERS as readonly string[]).includes(raw.renderer)) {
    opts.renderer = raw.renderer as ComposeOpts['renderer'];
  }
  if (
    typeof raw.phoneFormat === 'string' &&
    (PHONE_FORMATS as readonly string[]).includes(raw.phoneFormat)
  ) {
    opts.phoneFormat = raw.phoneFormat as ComposeOpts['phoneFormat'];
  }
  if (
    typeof raw.dateFormat === 'string' &&
    (DATE_FORMATS as readonly string[]).includes(raw.dateFormat)
  ) {
    opts.dateFormat = raw.dateFormat as ComposeOpts['dateFormat'];
  }
  return opts;
}

export type { InterchangeDocument };
