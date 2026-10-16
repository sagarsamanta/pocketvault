import { expect, test } from '@playwright/test';
import { cards, createLink, createNote, goHome, start } from './helpers';

test.describe('PocketVault 2.0', () => {
  test('formatting toolbar creates a checklist that can be ticked on the detail screen', async ({ page }) => {
    await start(page);
    await page.getByTestId('fab-add').click();
    await page.getByTestId('fab-note').click();
    await page.getByTestId('input-title').fill('Packing');
    const note = page.getByTestId('input-note');
    await note.click();
    await page.getByTestId('format-check').click();
    await note.pressSequentially('Passport');
    await page.getByTestId('format-check').click();
    await note.pressSequentially('Charger');
    await expect(note).toHaveValue('- [ ] Passport\n- [ ] Charger');
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('save-item')).toHaveCount(0);
    await expect(page.getByText('0/2 done')).toBeVisible();
    await page.getByTestId('check-0').click();
    await expect(page.getByText('1/2 done')).toBeVisible();
    await page.reload();
    await expect(page.getByText('1/2 done')).toBeVisible();
    await goHome(page);
    await expect(cards(page).first()).toContainText('1/2');
  });

  test('pinning keeps an item on top and colour labels are saved', async ({ page }) => {
    await start(page);
    await createNote(page, 'Old but important');
    await page.getByTestId('action-pin').click();
    await expect(page.getByTestId('toast')).toContainText('Pinned');
    await page.getByTestId('show-colors').click();
    await page.getByTestId('color-purple').click();
    await goHome(page);
    await createNote(page, 'Newer note');
    await goHome(page);
    await expect(cards(page).first()).toContainText('Old but important');
    await expect(cards(page).first().getByLabel(/pinned/)).toBeVisible();
    await page.getByTestId('filter-pinned').click();
    await expect(cards(page)).toHaveCount(1);
  });

  test('grid view is remembered', async ({ page }) => {
    await start(page);
    await createNote(page, 'Tile one');
    await goHome(page);
    await page.getByTestId('view-grid').click();
    await expect(page.locator('[data-testid="item-list"]').locator('[data-testid^="item-card-"]')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('view-grid')).toBeVisible();
    await expect(cards(page)).toHaveCount(1);
    await page.getByTestId('view-list').click();
    await expect(cards(page)).toHaveCount(1);
  });

  test('smart search understands natural language', async ({ page }) => {
    await start(page);
    await createNote(page, 'Recipe ideas', 'pasta');
    await goHome(page);
    await createLink(page, 'https://example.com/read', 'Article to read');
    await goHome(page);
    await page.getByTestId('search-input').fill('links this week');
    await expect(page.getByTestId('smart-chips')).toContainText('Links');
    await expect(page.getByTestId('smart-chips')).toContainText('This week');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Article to read');
    await page.getByTestId('search-input').fill('notes from last month');
    await expect(page.getByText('No matches')).toBeVisible();
  });

  test('saving the same link twice warns and can open the existing item', async ({ page }) => {
    await start(page);
    await createLink(page, 'https://www.example.com/story?utm_source=x', 'First save');
    await goHome(page);
    await page.getByTestId('fab-add').click();
    await page.getByTestId('fab-link').click();
    await page.getByTestId('input-url').fill('example.com/story/');
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('dialog')).toContainText('Already in your vault');
    await page.getByTestId('dialog-cancel').click(); // "Open existing"
    await expect(page.getByTestId('detail-title')).toHaveText('First save');
    await goHome(page);
    await expect(cards(page)).toHaveCount(1);
  });

  test('insights summarise the library', async ({ page }) => {
    await start(page);
    await createNote(page, 'A');
    await goHome(page);
    await createLink(page, 'https://a.example', 'B');
    await goHome(page);
    await page.getByTestId('nav-insights').click();
    await expect(page.getByTestId('insights')).toBeVisible();
    await expect(page.getByTestId('count-note')).toHaveText('1');
    await expect(page.getByTestId('count-link')).toHaveText('1');
    await expect(page.getByTestId('chart-weeks')).toBeVisible();
    await expect(page.getByTestId('chart-spending')).toBeVisible();
  });
});
