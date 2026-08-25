import { expect, test } from '@playwright/test';

test('opens the editor and creates a wall with four taps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cosa vuoi caricare?' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Prova con la stanza esempio' }).click();
  await expect(page.getByText('Stanza vuota con finestra', { exact: true })).toBeVisible();
  await expect(page.getByText('Originale intatto')).toBeVisible();

  await page.getByRole('button', { name: /Aggiungi muro/ }).click();
  const overlay = page.locator('.surface-overlay');
  await overlay.click({ position: { x: 260, y: 100 } });
  await overlay.click({ position: { x: 500, y: 100 } });
  await overlay.click({ position: { x: 500, y: 260 } });
  await overlay.click({ position: { x: 260, y: 260 } });
  await expect(page.getByRole('heading', { name: 'Muro 4' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Chiudi superficie' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Freeze superficie' })).toBeVisible();
  await page.getByRole('button', { name: 'Freeze superficie' }).click();
  await expect(page.getByText('Frozen')).toBeVisible();
});

test('exposes the projects route', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Progetti' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Crea nuovo progetto' })).toBeVisible();
});
