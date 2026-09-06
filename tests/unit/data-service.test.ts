import { describe, expect, it } from 'vitest';
import {
  createMemoryStorage,
  MemoryBlobStore,
  MemoryChannel,
} from '../../src/shared/adapters/memory.js';
import type { BackgroundEnv } from '../../src/shared/adapters/types.js';
import { createMemoryRuntime, createMemoryScripting } from '../../src/shared/adapters/memory.js';
import { createRouter } from '../../src/background/router.js';
import { DataService } from '../../src/background/data-service.js';
import { FileStore } from '../../src/background/file-store.js';
import { ProtocolClient } from '../../src/shared/messages.js';
import { validateImport } from '../../src/shared/validate-import.js';
import type { InterchangeDocument, Vault } from '../../src/shared/types.js';
import { DEFAULT_VERSION_NAME } from '../../src/shared/vault.js';
import sampleImport from '../../ai/examples/sample-import.json';
// (regression suite below needs these too)

function makeStack() {
  // Options-page context: privileged sender (vault.* is blocked for web-origin senders).
  const channel = new MemoryChannel({ origin: 'moz-extension://test' });
  const storage = createMemoryStorage();
  const blobs = new MemoryBlobStore();
  const env: BackgroundEnv = {
    storage,
    blobs,
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));
  return { client: new ProtocolClient(channel), storage, blobs };
}

describe('sample import fixture', () => {
  it('validates against ai/import.schema.json', () => {
    const result = validateImport(sampleImport);
    if (!result.valid) throw new Error(JSON.stringify(result.errors, null, 2));
    expect(result.valid).toBe(true);
  });

  it('schema rejects documents with unknown properties and bad dates', () => {
    const bad = JSON.parse(JSON.stringify(sampleImport)) as Record<string, unknown>;
    (bad.work as Record<string, unknown>[])[0]!.startDate = 'May 2022';
    bad.bogus = true;
    const result = validateImport(bad);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const paths = result.errors.map((e) => e.path).join(' ');
    expect(paths).toContain('/work/0/startDate');
  });
});

describe('DataService basics', () => {
  it('creates an empty vault with a default version on first access', async () => {
    const { client } = makeStack();
    const { vault } = await client.send({ t: 'vault.get' });
    expect(vault.schemaVersion).toBe(1);
    expect(vault.versions).toHaveLength(1);
    expect(vault.versions[0]?.name).toBe(DEFAULT_VERSION_NAME);
    expect(vault.settings.activeVersionId).toBe(vault.versions[0]?.id);
    expect(vault.settings.storeEeoAnswers).toBe(false);
  });

  it('persists across service instances (storage, not memory)', async () => {
    const storage = createMemoryStorage();
    const first = new DataService(storage, new FileStore(new MemoryBlobStore()));
    const vault = await first.getVault();
    vault.profile.identity.firstName = 'Maya';
    await first.patch([{ section: 'profile', value: vault.profile }]);

    const second = new DataService(storage, new FileStore(new MemoryBlobStore()));
    expect((await second.getVault()).profile.identity.firstName).toBe('Maya');
  });

  it('vault.patch validates section names', async () => {
    const { client } = makeStack();
    await expect(
      client.send({ t: 'vault.patch', ops: [{ section: 'nope', value: [] } as never] }),
    ).rejects.toThrow(/unknown patch section/);
  });

  it('vault.wipe requires the confirm token', async () => {
    const { client } = makeStack();
    await expect(client.send({ t: 'vault.wipe', confirm: 'oops' as never })).rejects.toThrow(
      /confirm/,
    );
  });

  it('version.setActive rejects unknown ids and accepts real ones', async () => {
    const { client } = makeStack();
    const { vault } = await client.send({ t: 'vault.get' });
    await expect(client.send({ t: 'version.setActive', id: 'nope' })).rejects.toThrow(/no version/);
    const { activeVersionId } = await client.send({
      t: 'version.setActive',
      id: vault.versions[0]!.id,
    });
    expect(activeVersionId).toBe(vault.versions[0]!.id);
  });

  it('refuses to decode unrecognized stored data instead of wiping it', async () => {
    const storage = createMemoryStorage();
    await storage.local.set('vault', { totally: 'unexpected' });
    const service = new DataService(storage, new FileStore(new MemoryBlobStore()));
    await expect(service.getVault()).rejects.toThrow(/unrecognized format/);
    // The bad data must still be there — never silently replaced.
    expect(await storage.local.get('vault')).toEqual({ totally: 'unexpected' });
  });
});

describe('import → export → wipe → import round-trip (DoD-1)', () => {
  it('survives the full cycle with entities, answers, versions and file bytes intact', async () => {
    const { client } = makeStack();

    // 1. Import the sample.
    const imported = await client.send({
      t: 'vault.import',
      document: sampleImport as unknown as InterchangeDocument,
    });
    expect(imported.summary.added.work).toBe(2);
    expect(imported.summary.added.files).toBe(1);
    expect(imported.vault.work).toHaveLength(2);

    // EEO storage is off by default; the sample has none, so nothing should be skipped for EEO.
    expect(imported.summary.skipped.filter((s) => s.includes('EEO'))).toHaveLength(0);

    // 2. Export.
    const { document: exported } = await client.send({ t: 'vault.export' });
    expect(exported.work).toHaveLength(2);
    expect(exported.files).toHaveLength(1);
    expect(exported.files?.[0]?.base64.length).toBeGreaterThan(0);

    // 3. Wipe.
    const { vault: wiped } = await client.send({ t: 'vault.wipe', confirm: 'wipe' });
    expect(wiped.work).toHaveLength(0);
    expect(wiped.files).toHaveLength(0);
    expect((await client.send({ t: 'file.list' })).files).toHaveLength(0);

    // 4. Re-import the export.
    const reimported = await client.send({ t: 'vault.import', document: exported });
    const vault: Vault = reimported.vault;
    expect(vault.work.map((w) => w.company).sort()).toEqual([
      'Brightline Health',
      'Harbor Freight Logistics',
    ]);
    expect(vault.answers).toHaveLength(5);
    // Imported versions + the fresh default.
    expect(vault.versions.length).toBeGreaterThanOrEqual(3);

    // 5. File bytes actually round-tripped (fetch through the protocol as a real File).
    const fileId = vault.files[0]?.id;
    expect(fileId).toBeDefined();
    const { file } = await client.send({ t: 'file.get', fileId: fileId! });
    expect(file.name).toBe('Maya_Okafor_Resume_2026.pdf');
    expect(file.type).toBe('application/pdf');
    const text = new TextDecoder().decode(await file.arrayBuffer());
    expect(text.startsWith('%PDF-1.4')).toBe(true);

    // 6. Content equality: exporting again yields the same entities (ids differ — merge-add
    // assigns fresh UUIDs — so compare the id-free projection).
    const { document: exported2 } = await client.send({ t: 'vault.export' });
    const scrub = (doc: InterchangeDocument): unknown =>
      JSON.parse(
        JSON.stringify(doc, (key, value: unknown) =>
          ['id', 'defaultVariantId', 'bytesRef', 'addedAt', 'variantPrefs', 'include'].includes(key)
            ? undefined
            : value,
        ),
      );
    expect(scrub(exported2)).toEqual(scrub(exported));
  });

  it('merge-add import is idempotent — importing the same document twice adds nothing', async () => {
    const { client } = makeStack();
    await client.send({
      t: 'vault.import',
      document: sampleImport as unknown as InterchangeDocument,
    });
    const second = await client.send({
      t: 'vault.import',
      document: sampleImport as unknown as InterchangeDocument,
    });
    expect(second.summary.added.work).toBe(0);
    expect(second.summary.added.answers).toBe(0);
    expect(second.summary.added.files).toBe(0);
    expect(second.summary.skipped.length).toBeGreaterThan(0);
    expect(second.vault.work).toHaveLength(2);
  });

  it('EEO answers are dropped on import unless storage is opted in (SPEC §4.3)', async () => {
    const { client } = makeStack();
    const withEeo = JSON.parse(JSON.stringify(sampleImport)) as InterchangeDocument;
    withEeo.answers = [
      ...(withEeo.answers ?? []),
      {
        key: 'veteranStatus',
        question: 'Veteran status',
        kind: 'choice',
        value: 'I am not a protected veteran',
        // Import file lies about sensitivity — must be forced true if ever stored.
        sensitive: false,
      },
    ];
    const result = await client.send({ t: 'vault.import', document: withEeo });
    expect(result.vault.answers.some((a) => a.key === 'veteranStatus')).toBe(false);
    expect(result.summary.skipped.some((s) => s.includes('veteranStatus'))).toBe(true);

    // Opt in, re-import: now stored, and forced sensitive despite the file's claim.
    const { vault } = await client.send({ t: 'vault.get' });
    vault.settings.storeEeoAnswers = true;
    await client.send({ t: 'vault.patch', ops: [{ section: 'settings', value: vault.settings }] });
    const second = await client.send({ t: 'vault.import', document: withEeo });
    const entry = second.vault.answers.find((a) => a.key === 'veteranStatus');
    expect(entry).toBeDefined();
    expect(entry?.sensitive).toBe(true);
  });

  it('salaryExpectation defaults sensitive but an explicit user choice is respected', async () => {
    // SPEC §7.9: "salary if the user marks it" — default on, unmarkable (unlike EEO).
    const { client } = makeStack();
    const explicitOff = JSON.parse(JSON.stringify(sampleImport)) as InterchangeDocument;
    explicitOff.answers = explicitOff.answers?.map((a) =>
      a.key === 'salaryExpectation' ? { ...a, sensitive: false } : a,
    );
    const offResult = await client.send({ t: 'vault.import', document: explicitOff });
    expect(offResult.vault.answers.find((a) => a.key === 'salaryExpectation')?.sensitive).toBe(
      false,
    );

    const { client: client2 } = makeStack();
    const unspecified = JSON.parse(JSON.stringify(sampleImport)) as InterchangeDocument;
    unspecified.answers = unspecified.answers?.map((a) => {
      if (a.key !== 'salaryExpectation') return a;
      const { sensitive: _sensitive, ...rest } = a;
      return rest as typeof a;
    });
    const defaultResult = await client2.send({ t: 'vault.import', document: unspecified });
    expect(defaultResult.vault.answers.find((a) => a.key === 'salaryExpectation')?.sensitive).toBe(
      true,
    );
  });

  it('criminalDisclosure sensitivity cannot be turned off by an import file', async () => {
    const { client } = makeStack();
    const doc = JSON.parse(JSON.stringify(sampleImport)) as InterchangeDocument;
    doc.answers = [
      ...(doc.answers ?? []),
      {
        key: 'criminalDisclosure',
        question: 'Have you ever been convicted of a felony?',
        kind: 'boolean',
        value: false,
        sensitive: false,
      },
    ];
    const result = await client.send({ t: 'vault.import', document: doc });
    expect(result.vault.answers.find((a) => a.key === 'criminalDisclosure')?.sensitive).toBe(true);
  });

  it('rejects invalid documents with path-precise errors', async () => {
    const { client } = makeStack();
    const bad = JSON.parse(JSON.stringify(sampleImport)) as Record<string, unknown>;
    (bad.profile as Record<string, unknown>).identity = { firstName: 'OnlyFirst' };
    await expect(client.send({ t: 'vault.import', document: bad as never })).rejects.toThrow(
      /identity/,
    );
  });
});

describe('files over the protocol', () => {
  it('add → list → get → delete, with version links dropped on delete', async () => {
    const { client } = makeStack();
    const bytes = new TextEncoder().encode('%PDF-fake').buffer as ArrayBuffer;
    const { file } = await client.send({
      t: 'file.add',
      kind: 'resume',
      name: 'r.pdf',
      mime: 'application/pdf',
      bytes,
    });
    expect((await client.send({ t: 'file.list' })).files).toHaveLength(1);

    // Link it to the active version, then delete the file: the link must not dangle.
    const { vault } = await client.send({ t: 'vault.get' });
    const versions = vault.versions.map((v) => ({ ...v, fileId: file.id }));
    await client.send({ t: 'vault.patch', ops: [{ section: 'versions', value: versions }] });

    const { files } = await client.send({ t: 'file.delete', fileId: file.id });
    expect(files).toHaveLength(0);
    const after = await client.send({ t: 'vault.get' });
    expect(after.vault.versions.every((v) => v.fileId === undefined)).toBe(true);
    await expect(client.send({ t: 'file.get', fileId: file.id })).rejects.toThrow(/no file/);
  });
});

describe('rung-1 review regressions', () => {
  it('content-script senders are refused vault-level requests (P1-8)', async () => {
    const channel = new MemoryChannel({ tabId: 3, frameId: 0, origin: 'https://jobs.example.com' });
    const storage = createMemoryStorage();
    const env = {
      storage,
      blobs: new MemoryBlobStore(),
      server: channel,
      scripting: createMemoryScripting(),
      runtime: createMemoryRuntime(),
    };
    env.server.serve(createRouter({ env }));
    const client = new ProtocolClient(channel);
    await expect(client.send({ t: 'vault.get' })).rejects.toThrow(/not available to content/);
    await expect(client.send({ t: 'vault.export' })).rejects.toThrow(/not available/);
    // The narrow fill-time surface stays open.
    await expect(client.send({ t: 'fill.context' })).resolves.toBeDefined();
    await expect(client.send({ t: 'ping' })).resolves.toMatchObject({ pong: true });
  });

  it('EEO answers cannot enter the vault via vault.patch while the gate is off (P1-2)', async () => {
    const { client } = makeStack();
    const { vault } = await client.send({ t: 'vault.get' });
    const patched = await client.send({
      t: 'vault.patch',
      ops: [
        {
          section: 'answers',
          value: [
            {
              id: 'evil',
              key: 'gender',
              question: 'Gender',
              patterns: [],
              kind: 'text',
              value: 'x',
              sensitive: false,
            },
          ],
        },
      ],
    });
    expect(patched.vault.answers).toHaveLength(0);
    expect(vault.settings.storeEeoAnswers).toBe(false);

    // With the gate on, the entry lands but is forced sensitive.
    await client.send({
      t: 'vault.patch',
      ops: [{ section: 'settings', value: { ...vault.settings, storeEeoAnswers: true } }],
    });
    const second = await client.send({
      t: 'vault.patch',
      ops: [
        {
          section: 'answers',
          value: [
            {
              id: 'ok',
              key: 'gender',
              question: 'Gender',
              patterns: [],
              kind: 'text',
              value: 'x',
              sensitive: false,
            },
          ],
        },
      ],
    });
    expect(second.vault.answers).toHaveLength(1);
    expect(second.vault.answers[0]?.sensitive).toBe(true);
  });

  it('garbage settings values are clamped on patch (P1-3)', async () => {
    const { client } = makeStack();
    const { vault } = await client.send({ t: 'vault.get' });
    const patched = await client.send({
      t: 'vault.patch',
      ops: [
        {
          section: 'settings',
          value: { ...vault.settings, fillAllThreshold: -5, suggestThreshold: Number.NaN },
        },
      ],
    });
    expect(patched.vault.settings.fillAllThreshold).toBe(0);
    expect(patched.vault.settings.suggestThreshold).toBe(0.5);
  });

  it('a failed import leaves the live vault untouched (P1-4 atomicity)', async () => {
    const { client } = makeStack();
    await client.send({
      t: 'vault.import',
      document: sampleImport as unknown as InterchangeDocument,
    });
    const before = await client.send({ t: 'vault.get' });

    // Duplicate work key + a NEW valid work entry + malformed variant deep inside: the deep
    // failure must roll back everything from this import.
    const bad = JSON.parse(JSON.stringify(sampleImport)) as InterchangeDocument;
    bad.work = [
      {
        company: 'Rollback Test Co',
        title: 'Engineer',
        startDate: '2020-01',
        summary: { variants: [] }, // schema requires minItems 1 — bypass schema, hit mergeAdd
      },
    ] as never;
    await expect(client.send({ t: 'vault.import', document: bad })).rejects.toThrow();
    const after = await client.send({ t: 'vault.get' });
    expect(after.vault.work.map((w) => w.company)).toEqual(before.vault.work.map((w) => w.company));
    expect(after.vault.work.some((w) => w.company === 'Rollback Test Co')).toBe(false);
  });

  it('export → wipe → import preserves version configuration (P1-5)', async () => {
    const { client } = makeStack();
    const imported = await client.send({
      t: 'vault.import',
      document: sampleImport as unknown as InterchangeDocument,
    });
    // Tune the default version so the round-trip has config to lose.
    const tuned = imported.vault.versions.map((v, i) =>
      i === 0
        ? {
            ...v,
            description: 'my tuned lens',
            stylePriority: ['responsibilities', 'long'],
            variantPrefs: { 'snip-1': 'var-9' },
          }
        : v,
    );
    await client.send({ t: 'vault.patch', ops: [{ section: 'versions', value: tuned }] });

    const { document: exported } = await client.send({ t: 'vault.export' });
    await client.send({ t: 'vault.wipe', confirm: 'wipe' });
    const restored = await client.send({ t: 'vault.import', document: exported });

    const defaultVersion = restored.vault.versions.find((v) => v.name === DEFAULT_VERSION_NAME);
    expect(defaultVersion?.description).toBe('my tuned lens');
    expect(defaultVersion?.stylePriority).toEqual(['responsibilities', 'long']);
    expect(defaultVersion?.variantPrefs).toMatchObject({ 'snip-1': 'var-9' });
  });

  it('a fresh vault export re-validates against the schema (P1-6)', async () => {
    const { client } = makeStack();
    const { document: doc } = await client.send({ t: 'vault.export' });
    const validation = validateImport(doc);
    if (!validation.valid) throw new Error(JSON.stringify(validation.errors));
    expect(validation.valid).toBe(true);
  });

  it('concurrent cold reads share one vault object (P1-7)', async () => {
    const storage = createMemoryStorage();
    const service = new DataService(storage, new FileStore(new MemoryBlobStore()));
    const [a, b] = await Promise.all([service.getVault(), service.getVault()]);
    expect(a).toBe(b);
  });

  it('work added via vault.patch joins include-all versions and composes (P1-9)', async () => {
    const { client } = makeStack();
    await client.send({ t: 'vault.get' });
    const work = [
      {
        id: 'w-ui',
        company: 'Typed In Options',
        title: 'Engineer',
        startDate: '2024-01',
        current: true,
        summary: {
          id: 's-ui',
          tags: [],
          variants: [{ id: 'v-ui', style: 'impact', text: 'Did things.' }],
          defaultVariantId: 'v-ui',
        },
        bullets: [],
      },
    ];
    const patched = await client.send({
      t: 'vault.patch',
      ops: [{ section: 'work', value: work }],
    });
    const active = patched.vault.versions.find(
      (v) => v.id === patched.vault.settings.activeVersionId,
    );
    expect(active?.include.workIds).toContain('w-ui');
    const composed = await client.send({ t: 'compose', key: 'work[0].company' });
    expect(composed.value).toBe('Typed In Options');
  });
});
