import { expect, test } from '@playwright/test';

test('opens the editor and imports a local image', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Carica la stanza' })).toBeVisible();

  await page.locator('#room-file').setInputFiles({
    name: 'stanza-demo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('synthetic-room'),
  });

  await expect(page.getByText('Stanza demo')).toBeVisible();
  await expect(page.getByText('Originale intatto')).toBeVisible();
  await expect(page.getByText('Disegna la prima superficie')).toBeVisible();

  await page.getByRole('button', { name: 'Inserisci tracciatura guidata' }).click();
  await expect(page.getByRole('button', { name: 'Freeze superficie' })).toBeVisible();
  await page.getByRole('button', { name: 'Freeze superficie' }).click();
  await expect(page.getByText('Frozen')).toBeVisible();
});

test('exposes the projects route', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Progetti' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Crea nuovo progetto' })).toBeVisible();
});
