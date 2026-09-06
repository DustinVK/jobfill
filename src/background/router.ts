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
import { buildSearchIndex, searchIndex } from '../shared/search.js';
import type { InterchangeDocument, StoredFileKind } from '../shared/types.js';
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

export function createRouter(deps: RouterDeps): MessageHandler {
  const files = deps.files ?? new FileStore(deps.env.blobs);
  const data = deps.data ?? new DataService(deps.env.storage, files);

  return async (message: unknown, _sender: MessageSender): Promise<Envelope<unknown>> => {
    if (!isRequest(message)) {
      return { ok: false, error: 'jobfill: malformed request' };
    }
    try {
      return { ok: true, data: await handle(message, data, files) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

async function handle(
  message: { t: string } & Record<string, unknown>,
  data: DataService,
  files: FileStore,
): Promise<unknown> {
  switch (message.t) {
    case 'ping':
      return { pong: true, version: EXTENSION_VERSION };

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
      const opts =
        message.opts === undefined ? {} : (expectObject(message.opts, 'opts') as ComposeOpts);
      const vault = await data.getVault();
      const value = compose(vault, key, opts);
      if (value === undefined) throw new Error(`jobfill: cannot compose key "${key}"`);
      return value;
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
      const record = await files.add({ kind, name, mime, bytes });
      const vault = await data.getVault();
      vault.files.push(record);
      await data.patch([]); // persist via the single write path (no section change needed)
      return { file: record };
    }

    case 'file.get': {
      const fileId = expectNonEmptyString(message.fileId, 'fileId');
      const vault = await data.getVault();
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
        vault.files = vault.files.filter((f) => f.id !== fileId);
        await data.patch([]); // persist + normalize (drops dangling version.fileId links)
      }
      return { files: (await data.getVault()).files };
    }

    default:
      throw new Error(`jobfill: unknown request "${message.t}"`);
  }
}

export type { InterchangeDocument };
