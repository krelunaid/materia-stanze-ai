import { expect, test } from '@playwright/test';

test('saves and reopens furniture, measurements and two uploaded samples with working image URLs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Prova con la stanza esempio' }).click();
  await page.getByRole('button', { name: 'Usa foto originale →' }).click();
  await page.getByRole('button', { name: 'Continua ai prodotti' }).click();
  await page.getByRole('button', { name: '✎ Correggi una misura' }).click();
  await page.getByLabel('Larghezza reale parete principale').fill('4,2');
  await page.getByRole('button', { name: 'Conferma', exact: true }).click();
  await page.getByRole('textbox', { name: 'Cerca materiali, colori o mobili' }).fill('divano');
  await page.getByRole('button', { name: /Divano chiaro/ }).click();
  const canvas = page.locator('.canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Missing room canvas');
  await canvas.click({ position: { x: box.width * .62, y: box.height * .78 } });
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  for (const name of ['pietra.png', 'rovere.png']) {
    await page.locator('#material-file').setInputFiles({ name, mimeType: 'image/png', buffer: pixel });
  }
  await page.getByRole('button', { name: 'Salva progetto', exact: true }).click();
  await expect(page.locator('.project-save-status')).toContainText('Salvato su questo dispositivo');
  await page.getByRole('link', { name: 'Vai ai progetti' }).click();
  await page.waitForURL('**/projects');
  await page.getByRole('link', { name: 'Continua', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sposta Divano chiaro', exact: true })).toBeVisible();
  await expect(page.locator('.room-measurement-card')).toContainText('4,2');
  const original = page.getByAltText('Originale importato: stanza-vuota-con-finestra.jpg');
  await expect(original).toBeVisible();
  expect(await original.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(1);
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('materia-projects'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const id = new URLSearchParams(location.search).get('project');
    const project = await new Promise<Record<string, unknown>>((resolve) => { const request = db.transaction('projects').objectStore('projects').get(id!); request.onsuccess = () => resolve(request.result); });
    db.close();
    const editor = project.editor as { materialSamples: [string, Blob][]; materials: { name: string }[]; furniture: unknown[]; manualRoomWidth: number };
    return { samples: editor.materialSamples.map(([, blob]) => blob.size), names: editor.materials.map((item) => item.name), furniture: editor.furniture.length, width: editor.manualRoomWidth };
  });
  expect(stored.samples).toEqual([pixel.length, pixel.length]);
  expect(stored.names).toEqual(expect.arrayContaining(['pietra', 'rovere']));
  expect(stored.furniture).toBe(1);
  expect(stored.width).toBe(4.2);
});
