// @vitest-environment jsdom
/**
 * FillSession safety pins (rung-2 review P1-12): the enforcement points of SPEC §7.9 live
 * here, exercised directly — deny-list immunity, sensitive confirm-first, fill-all
 * exclusions, map… promotion refusal, checkbox polarity, fillState survival.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { FillSession } from '../../src/content/session.js';
import { createRouter } from '../../src/background/router.js';
import {
  MemoryBlobStore,
  MemoryChannel,
  createMemoryRuntime,
  createMemoryScripting,
  createMemoryStorage,
} from '../../src/shared/adapters/memory.js';
import type { BackgroundEnv } from '../../src/shared/adapters/types.js';
import { ProtocolClient } from '../../src/shared/messages.js';
import { createEmptyVault } from '../../src/shared/vault.js';
import { mergeAdd } from '../../src/shared/interchange.js';
import type { InterchangeDocument } from '../../src/shared/types.js';
import sampleImport from '../../ai/examples/sample-import.json';

async function makeSession(): Promise<FillSession> {
  const channel = new MemoryChannel({ tabId: 1, frameId: 0, origin: 'https://jobs.example.com' });
  const storage = createMemoryStorage();
  const seeded = mergeAdd(createEmptyVault(), sampleImport as unknown as InterchangeDocument);
  await storage.local.set('vault', { v: 1, enc: 'none', data: seeded.vault });
  const env: BackgroundEnv = {
    storage,
    blobs: new MemoryBlobStore(),
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));
  return new FillSession(new ProtocolClient(channel));
}

function entryBySelector(session: FillSession, selector: string) {
  const el = document.querySelector(selector);
  const entry = session.current.entries.find(
    (e) => e.field.element === el || e.field.groupElements?.some((g) => g === el),
  );
  if (!entry) throw new Error(`no entry for ${selector}`);
  return entry;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('deny-list immunity (SPEC §7.9)', () => {
  it('fillEntry refuses skip-tier fields outright', async () => {
    document.body.innerHTML = `
      <label for="pw">Password</label><input id="pw" type="password">
      <label for="fn">First name</label><input id="fn">
      <label for="ln">Last name</label><input id="ln">`;
    const session = await makeSession();
    await session.refresh(document);
    const pw = entryBySelector(session, '#pw');
    expect(pw.classification.tier).toBe('skip');
    const result = await session.fillEntry(pw, 'hunter2', true);
    expect(result.ok).toBe(false);
    expect((document.querySelector('#pw') as HTMLInputElement).value).toBe('');
  });

  it('recordMapping cannot promote a deny-listed field (P0-4)', async () => {
    document.body.innerHTML = `
      <label for="ssn">Social Security Number</label><input id="ssn">
      <label for="fn">First name</label><input id="fn">
      <label for="ln">Last name</label><input id="ln">`;
    const session = await makeSession();
    await session.refresh(document);
    const ssn = entryBySelector(session, '#ssn');
    expect(ssn.classification.tier).toBe('skip');
    expect(session.recordMapping(ssn, 'identity.firstName')).toBe(false);
    expect(ssn.classification.tier).toBe('skip');
    // And it stays skip across a rescan.
    await session.refresh(document);
    expect(entryBySelector(session, '#ssn').classification.tier).toBe('skip');
  });

  it('recordMapping never washes away sensitivity', async () => {
    document.body.innerHTML = `
      <label for="g">Gender</label><select id="g"><option>Decline</option></select>
      <label for="fn">First name</label><input id="fn">
      <label for="ln">Last name</label><input id="ln">`;
    const session = await makeSession();
    await session.refresh(document);
    const gender = entryBySelector(session, '#g');
    expect(gender.classification.sensitive).toBe(true);
    session.recordMapping(gender, 'address.state');
    expect(gender.classification.sensitive).toBe(true);
    expect(gender.classification.tier).toBe('suggest');
  });
});

describe('sensitive confirm-first (SPEC §7.9)', () => {
  it('fillEntry refuses sensitive entries without explicit confirmation', async () => {
    document.body.innerHTML = `
      <label for="sal">Desired salary</label><input id="sal">
      <label for="fn">First name</label><input id="fn">
      <label for="ln">Last name</label><input id="ln">`;
    const session = await makeSession();
    await session.refresh(document);
    const salary = entryBySelector(session, '#sal');
    expect(salary.classification.sensitive).toBe(true);
    expect((await session.fillEntry(salary)).ok).toBe(false);
    expect((document.querySelector('#sal') as HTMLInputElement).value).toBe('');
    // Explicit confirm fills.
    expect((await session.fillEntry(salary, undefined, true)).ok).toBe(true);
    expect((document.querySelector('#sal') as HTMLInputElement).value).toBe('$150k');
  });

  it('autoEntries excludes sensitive answers-bank fields (P0-1)', async () => {
    document.body.innerHTML = `
      <label for="fn">First name</label><input id="fn">
      <label for="ln">Last name</label><input id="ln">
      <label for="em">Email</label><input id="em" type="email">
      <label for="sal">Desired salary</label><input id="sal">`;
    const session = await makeSession();
    await session.refresh(document);
    const autoIds = session.autoEntries().map((e) => e.field.element.id);
    expect(autoIds).toContain('fn');
    expect(autoIds).not.toContain('sal');
    // And review stepping excludes it too (P1-5) — badge-confirm only.
    expect(session.suggestEntries().map((e) => e.field.element.id)).not.toContain('sal');
  });
});

describe('checkbox polarity (P1-7)', () => {
  it('a verbose affirmative CHECKS the box; ambiguity fails loudly', async () => {
    document.body.innerHTML = `
      <label for="cb">I am authorized to work in the United States</label>
      <input id="cb" type="checkbox">
      <label for="fn">First name</label><input id="fn">
      <label for="ln">Last name</label><input id="ln">`;
    const session = await makeSession();
    await session.refresh(document);
    const cb = entryBySelector(session, '#cb');

    const yes = await session.fillEntry(cb, 'Yes, I am authorized to work in the US', true);
    expect(yes.ok).toBe(true);
    expect((document.querySelector('#cb') as HTMLInputElement).checked).toBe(true);

    const ambiguous = await session.fillEntry(cb, 'purple monkey dishwasher', true);
    expect(ambiguous.ok).toBe(false);
    // The box was NOT silently toggled by the failure.
    expect((document.querySelector('#cb') as HTMLInputElement).checked).toBe(true);
  });
});

describe('fillState survives rescans (P1-8)', () => {
  it('a filled badge state persists across refresh for surviving elements', async () => {
    document.body.innerHTML = `
      <label for="fn">First name</label><input id="fn">
      <label for="ln">Last name</label><input id="ln">
      <label for="em">Email</label><input id="em" type="email">`;
    const session = await makeSession();
    await session.refresh(document);
    const first = entryBySelector(session, '#fn');
    await session.fillEntry(first);
    expect(first.fillState).toBe('filled');

    await session.refresh(document); // SPA settle rescan
    expect(entryBySelector(session, '#fn').fillState).toBe('filled');

    session.undoAll();
    await session.refresh(document);
    expect(entryBySelector(session, '#fn').fillState).toBeUndefined();
  });
});

describe('repeated work groups + segmented dates (live Workday-form findings)', () => {
  const GROUP_HTML = `
    <div class="experience-group">
      <label for="g1-title">Job Title *</label><input id="g1-title">
      <label for="g1-company">Company *</label><input id="g1-company">
      <label for="g1-from-mm">From *</label>
      <input id="g1-from-mm" placeholder="MM" maxlength="2">
      <input id="g1-from-yy" placeholder="YYYY" maxlength="4" aria-label="From year">
      <label for="g1-desc">Role Description</label><textarea id="g1-desc" rows="4"></textarea>
    </div>
    <div class="experience-group">
      <label for="g2-title">Job Title *</label><input id="g2-title">
      <label for="g2-company">Company *</label><input id="g2-company">
      <label for="g2-desc">Role Description</label><textarea id="g2-desc" rows="4"></textarea>
    </div>`;

  it('group 2 proposes the SECOND included experience, not the current job again', async () => {
    document.body.innerHTML = GROUP_HTML;
    const session = await makeSession();
    await session.refresh(document);

    const g1 = entryBySelector(session, '#g1-company');
    const g2 = entryBySelector(session, '#g2-company');
    expect(g1.classification.key).toBe('work[0].company');
    expect(g2.classification.key).toBe('work[1].company');
    // Sample vault: Harbor Freight Logistics is current, Brightline Health is previous.
    expect(g1.value?.value).toBe('Harbor Freight Logistics');
    expect(g2.value?.value).toBe('Brightline Health');
    expect(entryBySelector(session, '#g2-desc').value?.value).toContain('claims ingestion');
  });

  it('segmented From dates fill month and year slices separately', async () => {
    document.body.innerHTML = GROUP_HTML;
    const session = await makeSession();
    await session.refresh(document);

    const mm = entryBySelector(session, '#g1-from-mm');
    const yy = entryBySelector(session, '#g1-from-yy');
    expect(mm.classification.key).toBe('work[0].startDate');
    expect(yy.classification.key).toBe('work[0].startDate');
    expect(mm.classification.datePart).toBe('month');
    expect(yy.classification.datePart).toBe('year');

    await session.fillEntry(mm, undefined, true);
    await session.fillEntry(yy, undefined, true);
    // Harbor Freight start date is 2022-03.
    expect((document.querySelector('#g1-from-mm') as HTMLInputElement).value).toBe('03');
    expect((document.querySelector('#g1-from-yy') as HTMLInputElement).value).toBe('2022');
  });

  it('a current role refuses to write "Present" into an end-date segment', async () => {
    document.body.innerHTML = `
      <div class="experience-group">
        <label for="t">Job Title *</label><input id="t">
        <label for="c">Company *</label><input id="c">
        <label for="to-mm">To *</label>
        <input id="to-mm" placeholder="MM" maxlength="2">
        <input id="to-yy" placeholder="YYYY" maxlength="4" aria-label="To year">
      </div>`;
    const session = await makeSession();
    await session.refresh(document);
    const toMm = entryBySelector(session, '#to-mm');
    expect(toMm.classification.key).toBe('work[0].endDate');
    const result = await session.fillEntry(toMm, undefined, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('currently work here');
    expect((document.querySelector('#to-mm') as HTMLInputElement).value).toBe('');
  });
});

describe('defaulted proposals never auto-fill (phone type)', () => {
  it('a phone-type select with nothing stored is demoted to suggest', async () => {
    document.body.innerHTML = `
      <label for="fn">First name</label><input id="fn">
      <label for="ln">Last name</label><input id="ln">
      <label for="em">Email</label><input id="em" type="email">
      <label for="pt">Phone Type</label>
      <select id="pt"><option>Select…</option><option>Mobile</option><option>Home</option></select>`;
    const session = await makeSessionWithoutPhoneType();
    await session.refresh(document);
    const entry = entryBySelector(session, '#pt');
    expect(entry.value?.defaulted).toBe(true);
    expect(entry.classification.tier).toBe('suggest');
    expect(session.autoEntries().map((e) => e.field.element.id)).not.toContain('pt');
    // Explicit confirm still fills it.
    const result = await session.fillEntry(entry, undefined, true);
    expect(result.ok).toBe(true);
    const select = document.querySelector('#pt') as HTMLSelectElement;
    expect(select.selectedOptions[0]?.text).toBe('Mobile');
  });
});

async function makeSessionWithoutPhoneType(): Promise<FillSession> {
  const channel = new MemoryChannel({ tabId: 1, frameId: 0, origin: 'https://jobs.example.com' });
  const storage = createMemoryStorage();
  const seeded = mergeAdd(createEmptyVault(), sampleImport as unknown as InterchangeDocument);
  delete seeded.vault.profile.contact.phoneType;
  await storage.local.set('vault', { v: 1, enc: 'none', data: seeded.vault });
  const env: BackgroundEnv = {
    storage,
    blobs: new MemoryBlobStore(),
    server: channel,
    scripting: createMemoryScripting(),
    runtime: createMemoryRuntime(),
  };
  env.server.serve(createRouter({ env }));
  return new FillSession(new ProtocolClient(channel));
}
