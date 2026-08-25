import { expect, test } from '@playwright/test';

test('opens the editor and freezes a recognised wall', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cosa vuoi caricare?' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Prova con la stanza esempio' }).click();
  await expect(page.getByRole('img', { name: 'Originale importato: stanza-vuota-con-finestra.jpg' })).toBeVisible();
  await expect(page.getByText('Originale intatto', { exact: true }).filter({ visible: true })).toBeVisible();

  await page.getByRole('button', { name: /Muro 1.*Modificabile/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Mantieni identico Muro 1' }).filter({ visible: true }).click();
  await expect(page.getByRole('button', { name: 'Consenti modifiche a Muro 1' }).filter({ visible: true })).toBeVisible();
});

test('exposes the projects route', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Progetti' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Crea nuovo progetto' })).toBeVisible();
});
