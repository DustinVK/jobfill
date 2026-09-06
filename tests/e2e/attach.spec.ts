import { expect, test, type Page } from '@playwright/test';
import { injectContentBundle } from './helpers.js';

/**
 * File-attach e2e (DoD-3): a stored file travels background → content as a real `File`
 * and lands in page JS via BOTH §7.5 paths — hidden-input `.files` set and synthesized
 * drop. The page reads name/size/bytes back through its own FileReader; that readout is
 * what we assert. (The wrappedJSObject branch is real-extension-only — manual QA.)
 */

interface ReceivedFile {
  via: string;
  name: string;
  size: number;
  type: string;
  head: string;
}

async function fetchStoredFileAndAttach(page: Page, targetSelector: string): Promise<void> {
  await page.evaluate(async (selector) => {
    const handle = window.__jobfillHarness!;
    const context = await handle.session.client.send({ t: 'fill.context' });
    if (!context.attachedFile) throw new Error('no attached file offered by fill.context');
    const { file } = await handle.session.client.send({
      t: 'file.get',
      fileId: context.attachedFile.id,
    });
    const target = document.querySelector(selector);
    if (!target) throw new Error(`no target ${selector}`);
    const result = handle.attach.attachFile(target, file);
    if (!result.ok) throw new Error(`attach failed: ${result.reason ?? '?'}`);
  }, targetSelector);
}

async function received(page: Page): Promise<ReceivedFile[]> {
  await page.waitForFunction(
    () => ((window as { __receivedFiles?: unknown[] }).__receivedFiles?.length ?? 0) > 0,
  );
  return page.evaluate(
    () => (window as unknown as { __receivedFiles: ReceivedFile[] }).__receivedFiles,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/dropzone.html');
  await injectContentBundle(page);
});

test('hidden-input path: dropzone wrapping a real input receives the stored resume', async ({
  page,
}) => {
  // Target the dropzone DIV — attachFile must discover the hidden input behind it.
  await fetchStoredFileAndAttach(page, '#zone-with-input');
  const files = await received(page);
  expect(files).toHaveLength(1);
  const file = files[0]!;
  expect(file.via).toBe('input-change');
  expect(file.name).toBe('Maya_Okafor_Resume_2026.pdf');
  expect(file.type).toBe('application/pdf');
  expect(file.size).toBeGreaterThan(100);
  // Page-side FileReader saw the actual bytes.
  expect(file.head).toBe('%PDF-1.4');
});

test('drop path: an input-less dropzone receives the File via synthesized drag events', async ({
  page,
}) => {
  await fetchStoredFileAndAttach(page, '#zone-drop-only');
  const files = await received(page);
  expect(files).toHaveLength(1);
  const file = files[0]!;
  expect(file.via).toBe('drop');
  expect(file.name).toBe('Maya_Okafor_Resume_2026.pdf');
  expect(file.head).toBe('%PDF-1.4');
});

test('the environment detection picks the plain branch outside a real extension', async ({
  page,
}) => {
  const environment = await page.evaluate(() =>
    window.__jobfillHarness!.attach.detectAttachEnvironment(window),
  );
  expect(environment).toBe('plain');
});
