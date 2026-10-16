import { expect, Page } from '@playwright/test';

export async function openFresh(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  return errors;
}

export async function completeOnboarding(page: Page) {
  await expect(page.getByTestId('onboarding')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('onboarding-next')).toContainText('Get started');
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByTestId('search-input')).toBeVisible();
}

export async function start(page: Page) {
  const errors = await openFresh(page);
  await completeOnboarding(page);
  return errors;
}

export async function createNote(page: Page, title: string, note = '', tags: string[] = []) {
  await page.getByTestId('fab-add').click();
  await page.getByTestId('fab-note').click();
  await page.getByTestId('input-title').fill(title);
  if (note) await page.getByTestId('input-note').fill(note);
  for (const t of tags) {
    await page.getByTestId('tag-input').fill(t);
    await page.getByTestId('tag-input').press('Enter');
  }
  await page.getByTestId('save-item').click();
  await expect(page.getByTestId('detail-title')).toHaveText(title);
  // The editor is replaced by the detail screen once the save has fully completed.
  await expect(page.getByTestId('save-item')).toHaveCount(0);
}

export async function createLink(page: Page, url: string, title = '') {
  await page.getByTestId('fab-add').click();
  await page.getByTestId('fab-link').click();
  await page.getByTestId('input-url').fill(url);
  if (title) await page.getByTestId('input-title').fill(title);
  await page.getByTestId('save-item').click();
  await expect(page.getByTestId('detail-title')).toBeVisible();
  await expect(page.getByTestId('save-item')).toHaveCount(0);
}

export async function goHome(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('search-input')).toBeVisible();
}

export async function confirmDialog(page: Page) {
  await expect(page.getByTestId('dialog')).toBeVisible();
  await page.getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('dialog')).toBeHidden();
}

export function cards(page: Page) {
  return page.locator('[data-testid^="item-card-"]');
}
