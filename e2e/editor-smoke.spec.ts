import { expect, test } from '@playwright/test';

test('opens the editor and freezes a recognised wall', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cosa vuoi caricare?' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Prova con la stanza esempio' }).click();
  await expect(page.getByRole('img', { name: 'Originale importato: stanza-vuota-con-finestra.jpg' })).toBeVisible();
  await expect(page.getByText('Originale intatto', { exact: true }).filter({ visible: true })).toBeVisible();

  await page.getByRole('button', { name: 'Usa foto originale →' }).click();
  await page.getByRole('button', { name: /Muro 1.*Modificabile/ }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Mantieni identico Muro 1' }).filter({ visible: true }).click();
  await expect(page.getByRole('button', { name: 'Consenti modifiche a Muro 1' }).filter({ visible: true })).toBeVisible();
});

test('exposes the projects route', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Progetti' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Crea nuovo progetto' })).toBeVisible();
});

test('keeps iPhone form controls at a non-zooming size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Prova con la stanza esempio' }).click();
  await page.getByRole('button', { name: 'Usa foto originale →' }).click();

  const search = page.getByRole('textbox', { name: 'Cerca materiali, colori o mobili' });
  await expect(search).toBeVisible();
  await expect(search).toHaveCSS('font-size', '16px');
  await expect(page.locator('main')).toHaveJSProperty('scrollLeft', 0);
  const overflow = await page.locator('main').evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('places, resizes and locks furniture at a chosen room point', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Prova con la stanza esempio' }).click();
  await page.getByRole('button', { name: 'Usa foto originale →' }).click();
  const search = page.getByRole('textbox', { name: 'Cerca materiali, colori o mobili' });
  await search.fill('divano');
  await page.getByRole('button', { name: /Divano chiaro/ }).click();
  await expect(page.getByText('Tocca il punto sul pavimento')).toBeVisible();

  const canvas = page.locator('.canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Anteprima stanza non disponibile');
  await canvas.click({ position: { x: box.width * .62, y: box.height * .78 } });

  await expect(page.getByRole('button', { name: 'Sposta Divano chiaro' })).toBeVisible();
  await page.getByRole('button', { name: 'Ingrandisci mobile' }).click();
  await page.getByRole('button', { name: '◆ Blocca posizione' }).click();
  await expect(page.getByText('Posizione bloccata')).toBeVisible();
});
