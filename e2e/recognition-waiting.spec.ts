import { expect, test, type Page } from '@playwright/test';

const detectedSurfaces = {
  surfaces: [
    { name: 'Muro', kind: 'wall', confidence: .9, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: .72 }, { x: 0, y: .72 }] },
    { name: 'Pavimento', kind: 'floor', confidence: .94, points: [{ x: 0, y: .72 }, { x: 1, y: .72 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
  ],
};

async function holdDetectSurfaces(page: Page) {
  let releaseDetect = () => undefined;
  const detectReleased = new Promise<void>((resolve) => { releaseDetect = resolve; });
  await page.route('**/api/capabilities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ aiReady: true, providerLabel: 'Grok', auditorReady: true }),
    });
  });
  await page.route('**/api/detect-surfaces', async (route) => {
    await detectReleased;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detectedSurfaces),
    });
  });
  return () => releaseDetect();
}

test('shows a live recognition overlay until detect finishes on Prepara', async ({ page }) => {
  const releaseDetect = await holdDetectSurfaces(page);
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  await page.locator('#room-file').setInputFiles('public/demo-room.jpg');
  await expect(page.getByRole('img', { name: 'Originale importato: demo-room.jpg' })).toBeVisible();

  const overlay = page.locator('.processing-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Riconosco la stanza…');
  await expect(overlay).toContainText('Sto cercando muri, pavimento e soffitto. Di solito 30–90 secondi, al massimo circa 2 minuti. Le linee appariranno a fine riconoscimento.');
  await expect(overlay).toContainText(/Passati \d+ s…/);
  await expect(page.getByLabel('Assistente Materia')).toContainText('Riconosco la stanza…');
  await expect(page.getByLabel('Assistente Materia')).toHaveClass(/is-working/);
  await expect(page.locator('.surface-kind-wall')).toHaveCount(0);

  releaseDetect();

  await expect(page.getByText('Riconoscimento completato. Scegli se svuotare la stanza o usare la foto originale.')).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.surface-kind-wall')).toHaveCount(1);
  await expect(page.getByLabel('Assistente Materia')).not.toHaveClass(/is-working/);
  await expect(page.getByLabel('Assistente Materia')).toContainText('Riconoscimento completato');
});

test('shows the same overlay when retrying recognition from Controlla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const releaseDetect = await holdDetectSurfaces(page);
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Prova con la stanza esempio' }).click();
  await page.getByRole('button', { name: 'Usa foto originale →' }).click();
  await expect(page.getByRole('button', { name: /Controlla/ })).toHaveClass(/is-active/);

  await page.getByRole('button', { name: 'Rifai riconoscimento automatico' }).click();
  const overlay = page.locator('.processing-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Riconosco la stanza…');
  await expect(overlay).toContainText(/Passati \d+ s…/);
  await expect(page.getByLabel('Assistente Materia')).toHaveClass(/is-working/);
  await expect(page.getByRole('button', { name: 'Rifai riconoscimento automatico' })).toBeDisabled();

  releaseDetect();

  await expect(page.getByText(/superfici proposte da controllare/)).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rifai riconoscimento automatico' })).toBeEnabled();
});
