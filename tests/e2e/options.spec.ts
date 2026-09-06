import { expect, test, type Page } from '@playwright/test';

/**
 * DoD-1: the options app is usable — create a work experience whose bullet has 2 variants,
 * reload the page, and everything is still there (vault persisted through the DataService
 * into the storage adapter; localStorage-backed in this harness).
 */

async function freshOptions(page: Page) {
  await page.goto('/options-dev.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible();
}

test('profile edits persist across reload', async ({ page }) => {
  await freshOptions(page);

  await page.getByLabel('First name').fill('Maya');
  await page.getByLabel('Last name').fill('Okafor');
  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('status')).toHaveText('Saved.');

  await page.reload();
  await expect(page.getByLabel('First name')).toHaveValue('Maya');
  await expect(page.getByLabel('Last name')).toHaveValue('Okafor');
});

test('work experience with two bullet variants survives reload (DoD-1)', async ({ page }) => {
  await freshOptions(page);

  await page.getByRole('tab', { name: 'Work' }).click();
  await page.getByTestId('add-work').click();
  await page.getByTestId('work-company').fill('Harbor Freight Logistics');
  await page.getByTestId('work-title').fill('Senior Software Engineer');
  await page.getByTestId('work-start').fill('2022-03');

  // Give the role a bullet with two variant phrasings.
  await page.getByTestId('add-bullet').click();
  const bullet = page.getByTestId('bullet-block').first();
  await bullet
    .getByTestId('variant-text-impact')
    .fill('Rewrote the routing engine, cutting p99 latency 77%.');
  await bullet.getByTestId('add-variant').click();
  await expect(bullet.getByTestId('variant-row')).toHaveCount(2);
  // The new variant pre-fills with the default text (SPEC §3.2); restyle + rewrite it.
  const secondRow = bullet.getByTestId('variant-row').nth(1);
  await secondRow.getByRole('button', { name: 'responsibilities', exact: true }).click();
  await secondRow
    .locator('textarea')
    .fill('Redesigned and reimplemented the routing engine with load testing.');

  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('status')).toHaveText('Saved.');

  await page.reload();
  await page.getByRole('tab', { name: 'Work' }).click();
  await expect(page.getByTestId('work-company')).toHaveValue('Harbor Freight Logistics');
  const reloadedBullet = page.getByTestId('bullet-block').first();
  await expect(reloadedBullet.getByTestId('variant-row')).toHaveCount(2);
  await expect(reloadedBullet.getByTestId('variant-text-impact')).toHaveValue(
    'Rewrote the routing engine, cutting p99 latency 77%.',
  );
  await expect(reloadedBullet.getByTestId('variant-text-responsibilities')).toHaveValue(
    'Redesigned and reimplemented the routing engine with load testing.',
  );
});

test('answers bank: EEO entries are gated behind the opt-in', async ({ page }) => {
  await freshOptions(page);
  await page.getByRole('tab', { name: 'Answers' }).click();

  // No EEO add buttons before opting in.
  await expect(page.getByRole('button', { name: '+ gender' })).toHaveCount(0);
  await page.getByTestId('eeo-opt-in').check();
  await page.getByRole('button', { name: '+ veteranStatus' }).click();
  const row = page.getByTestId('answer-row').last();
  // Forced sensitive and locked.
  await expect(row.getByTestId('answer-sensitive')).toBeChecked();
  await expect(row.getByTestId('answer-sensitive')).toBeDisabled();

  // Opting back out removes the stored EEO entry.
  await page.getByTestId('eeo-opt-in').uncheck();
  await expect(page.getByTestId('answer-row')).toHaveCount(0);
});

test('versions: rename + switch active persists', async ({ page }) => {
  await freshOptions(page);
  await page.getByRole('tab', { name: 'Versions' }).click();

  await expect(page.getByTestId('version-row')).toHaveCount(1);
  await page.getByRole('button', { name: '+ Add version' }).click();
  const second = page.getByTestId('version-row').nth(1);
  await second.getByTestId('version-name').fill('Responsibilities (gov)');
  await second.getByTestId('version-styles').fill('responsibilities, long');
  await second.getByTestId('version-styles').blur();
  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('status')).toHaveText('Saved.');

  await second.getByRole('button', { name: 'Make active' }).click();
  await expect(second.getByTestId('active-badge')).toBeVisible();

  await page.reload();
  await page.getByRole('tab', { name: 'Versions' }).click();
  const reloadedSecond = page.getByTestId('version-row').nth(1);
  await expect(reloadedSecond.getByTestId('version-name')).toHaveValue('Responsibilities (gov)');
  await expect(reloadedSecond.getByTestId('active-badge')).toBeVisible();
});

test('import shows a summary and the data lands; export round-trips', async ({ page }) => {
  await freshOptions(page);
  await page.getByRole('tab', { name: 'Import / Export' }).click();

  // Import the shipped sample fixture — dry-run preview first, then confirm.
  await page.getByTestId('import-file').setInputFiles('ai/examples/sample-import.json');
  await expect(page.getByTestId('import-preview')).toBeVisible();
  await expect(page.getByTestId('import-preview')).toContainText('Will add 2 work');
  await page.getByTestId('confirm-import').click();
  await expect(page.getByTestId('import-summary')).toBeVisible();
  await expect(page.getByTestId('import-summary')).toContainText('Added 2 work');

  await page.getByRole('tab', { name: 'Work' }).click();
  await expect(page.getByTestId('work-entry')).toHaveCount(2);

  // Export produces a JSON download containing the imported data.
  await page.getByRole('tab', { name: 'Import / Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-btn').click();
  const download = await downloadPromise;
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const exported = JSON.parse(await readFile(path, 'utf8')) as {
    work: { company: string }[];
    files: { name: string }[];
  };
  expect(exported.work.map((w) => w.company).sort()).toEqual([
    'Brightline Health',
    'Harbor Freight Logistics',
  ]);
  expect(exported.files[0]?.name).toBe('Maya_Okafor_Resume_2026.pdf');
});

test('import of an invalid file renders a path-precise error report', async ({ page }) => {
  await freshOptions(page);
  await page.getByRole('tab', { name: 'Import / Export' }).click();

  await page.getByTestId('import-file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ schemaVersion: 1, profile: { identity: { firstName: 'X' } } }),
    ),
  });
  await expect(page.getByTestId('import-errors')).toBeVisible();
  await expect(page.getByTestId('import-errors')).toContainText('/profile/identity');
});

test('files manager: upload, link to version, delete (rung 3)', async ({ page }) => {
  await freshOptions(page);
  await page.getByRole('tab', { name: 'Files' }).click();
  await expect(page.getByText('No files yet')).toBeVisible();

  await page.getByTestId('file-upload').setInputFiles({
    name: 'Maya_Resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake resume bytes'),
  });
  const row = page.getByTestId('file-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Maya_Resume.pdf');
  await expect(row).toContainText('Not attached to any version');

  // Link to the default version, then save the versions section.
  await row.getByTestId('link-version').selectOption({ index: 1 });
  await expect(row).toContainText('Attached to: Everything / impact-first');
  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('status')).toHaveText('Saved.');

  // Delete removes the row and the dangling version link.
  page.on('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('file-row')).toHaveCount(0);
});
