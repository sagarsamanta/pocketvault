import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import { cards, completeOnboarding, confirmDialog, createLink, createNote, goHome, openFresh, start } from './helpers';

test.describe('first launch', () => {
  test('onboarding leads to an empty library and is remembered', async ({ page }) => {
    const errors = await openFresh(page);
    await expect(page.getByText('Everything you want to keep')).toBeVisible();
    await completeOnboarding(page);
    await expect(page.getByText('Your stash is empty')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('search-input')).toBeVisible();
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('skip finishes onboarding', async ({ page }) => {
    await openFresh(page);
    await page.getByTestId('onboarding-skip').click();
    await expect(page.getByTestId('search-input')).toBeVisible();
  });
});

test.describe('items', () => {
  test('create, view, edit and delete a note', async ({ page }) => {
    const errors = await start(page);
    await createNote(page, 'Grocery list', 'Oat milk\nBananas');
    await expect(page.getByTestId('detail-note')).toContainText('Bananas');

    await page.getByTestId('detail-edit').click();
    await page.getByTestId('input-title').fill('Weekly groceries');
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('save-item')).toHaveCount(0);
    await expect(page.getByTestId('detail-title')).toHaveText('Weekly groceries');

    await goHome(page);
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Weekly groceries');

    await cards(page).first().click();
    await page.getByTestId('detail-delete').click();
    await page.getByTestId('dialog-cancel').click();
    await expect(page.getByTestId('detail-title')).toBeVisible();
    await page.getByTestId('detail-delete').click();
    await confirmDialog(page);
    await expect(page.getByText('Your stash is empty')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('empty notes cannot be saved', async ({ page }) => {
    await start(page);
    await page.getByTestId('fab-add').click();
    await page.getByTestId('add-note').click();
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('toast')).toContainText('Add a title, note, link or file');
  });

  test('links are validated, opened and copied', async ({ page, context }) => {
    await start(page);
    await page.getByTestId('fab-add').click();
    await page.getByTestId('add-link').click();
    await page.getByTestId('save-item').click();
    await expect(page.getByText('Enter a link to save.')).toBeVisible();
    await page.getByTestId('input-url').fill('example.com/article');
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('detail-title')).toHaveText('example.com');
    await expect(page.getByText('https://example.com/article')).toBeVisible();

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('action-copy').click();
    await expect(page.getByTestId('toast')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com/article');

    const popup = page.waitForEvent('popup');
    await page.getByTestId('action-open').click();
    expect((await popup).url()).toContain('example.com/article');
  });

  test('items persist across reloads', async ({ page }) => {
    await start(page);
    await createNote(page, 'Survives reload', 'persisted');
    await page.reload();
    await expect(page.getByTestId('detail-title')).toHaveText('Survives reload');
    await goHome(page);
    await expect(cards(page)).toHaveCount(1);
  });
});

test.describe('organizing', () => {
  test('collections can be created, assigned, filtered, renamed and deleted', async ({ page }) => {
    await start(page);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('nav-collections').click();
    await page.getByTestId('collection-create-empty').click();
    await page.getByTestId('dialog-input').fill('Recipes');
    await confirmDialog(page);
    await expect(page.getByTestId('collection-row-Recipes')).toBeVisible();

    // duplicate names are rejected
    await page.getByTestId('collection-add').click();
    await page.getByTestId('dialog-input').fill('recipes');
    await confirmDialog(page);
    await expect(page.getByTestId('toast')).toContainText('already exists');

    await goHome(page);
    await page.getByTestId('fab-add').click();
    await page.getByTestId('add-note').click();
    await page.getByTestId('input-title').fill('Pancakes');
    await page.getByTestId('collection-option-Recipes').click();
    await page.getByTestId('save-item').click();
    await expect(page.getByTestId('detail-title')).toHaveText('Pancakes');
    await expect(page.getByTestId('save-item')).toHaveCount(0);
    await goHome(page);
    await createNote(page, 'Unrelated');
    await goHome(page);
    await expect(cards(page)).toHaveCount(2);
    await page.getByTestId('filter-collection-Recipes').click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Pancakes');

    await page.goto('/collections');
    await page.getByTestId('collection-rename-Recipes').click();
    await page.getByTestId('dialog-input').fill('Cooking');
    await confirmDialog(page);
    await expect(page.getByTestId('collection-row-Cooking')).toContainText('1 item');
    await page.getByTestId('collection-delete-Cooking').click();
    await expect(page.getByTestId('dialog')).toContainText('will be kept');
    await confirmDialog(page);
    await expect(page.getByText('No collections yet')).toBeVisible();
    await goHome(page);
    await expect(cards(page)).toHaveCount(2);
  });

  test('tags can be assigned, used for filtering and removed', async ({ page }) => {
    await start(page);
    await createNote(page, 'Trip plan', 'Passport', ['travel', 'Japan']);
    await expect(page.getByLabel('Show items tagged travel')).toBeVisible();
    await expect(page.getByLabel('Show items tagged Japan')).toBeVisible();
    await goHome(page);
    await createNote(page, 'Work notes', '', ['work']);
    await goHome(page);
    await page.getByTestId('filter-tag-travel').click();
    await expect(cards(page)).toHaveCount(1);
    await page.getByTestId('filter-tag-travel').click();
    await expect(cards(page)).toHaveCount(2);

    await cards(page).filter({ hasText: 'Trip plan' }).click();
    await page.getByTestId('edit-tags').click();
    await page.getByLabel('Remove #Japan').click();
    await page.getByText('Done').click();
    await expect(page.getByLabel('Show items tagged Japan')).toHaveCount(0);
    await goHome(page);
    await page.getByTestId('search-input').fill('japan');
    await expect(page.getByText('No matches')).toBeVisible();
  });

  test('favorites can be toggled and filtered', async ({ page }) => {
    await start(page);
    await createNote(page, 'Keep me close');
    await goHome(page);
    await createNote(page, 'Ordinary');
    await goHome(page);
    const card = cards(page).filter({ hasText: 'Keep me close' });
    await card.getByLabel('Add to favorites').click();
    await expect(card.getByLabel('Remove from favorites')).toBeVisible();
    await page.getByTestId('filter-favorites').click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Keep me close');
  });
});

test.describe('search', () => {
  test('finds items by title, note, URL and tag; shows empty state', async ({ page }) => {
    await start(page);
    await createNote(page, 'Grocery list', 'Buy oat milk');
    await goHome(page);
    await createNote(page, 'Trip', 'Passport', ['travel']);
    await goHome(page);
    await createLink(page, 'https://reactnative.dev/blog/new-arch', 'Architecture article');
    await goHome(page);

    const search = page.getByTestId('search-input');
    const expectOnly = async (q: string, title: string) => {
      await search.fill(q);
      await expect(cards(page)).toHaveCount(1);
      await expect(cards(page).first()).toContainText(title);
    };
    await expectOnly('grocery', 'Grocery list');
    await expectOnly('oat', 'Grocery list');
    await expectOnly('reactnative', 'Architecture article');
    await expectOnly('travel', 'Trip');
    await search.fill('nothing-matches-this');
    await expect(page.getByText('No matches')).toBeVisible();
    await page.getByText('Clear filters').click();
    await expect(cards(page)).toHaveCount(3);
  });
});

test.describe('reminders', () => {
  test('create, reschedule, complete and cancel reminders', async ({ page }) => {
    await start(page);
    await createNote(page, 'Call the dentist');
    await page.getByTestId('add-reminder').click();
    await page.getByTestId('preset-Tomorrow morning').click();
    await expect(page.getByTestId('toast')).toContainText('Reminder set for Tomorrow');
    await expect(page.getByTestId('reminder-scheduled')).toHaveCount(1);

    // custom date/time via the picker
    await page.getByTestId('add-reminder').click();
    await page.getByTestId('preset-custom').click();
    const future = new Date(Date.now() + 3 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await page
      .getByTestId('datetime-input')
      .fill(`${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T15:30`);
    await page.getByTestId('datetime-ok').click();
    await expect(page.getByTestId('reminder-scheduled')).toHaveCount(2);

    await page.getByTestId('reminder-complete').first().click();
    await expect(page.getByTestId('reminder-completed')).toHaveCount(1);
    await page.getByTestId('reminder-cancel').first().click();
    await expect(page.getByTestId('reminder-cancelled')).toHaveCount(1);

    await page.goto('/reminders');
    await expect(page.getByText('Done & cancelled'.toUpperCase())).toBeVisible();
    await expect(page.getByText('Call the dentist')).toHaveCount(2);
  });

  test('past custom times are rejected', async ({ page }) => {
    await start(page);
    await createNote(page, 'Past reminder');
    await page.getByTestId('add-reminder').click();
    await page.getByTestId('preset-custom').click();
    await page.getByTestId('datetime-input').fill('2020-01-01T10:00');
    await page.getByTestId('datetime-ok').click();
    await expect(page.getByTestId('toast')).toContainText('future');
    await expect(page.getByTestId('reminder-scheduled')).toHaveCount(0);
  });
});

test.describe('backup and settings', () => {
  test('export, erase (with typed confirmation) and restore a backup', async ({ page }, testInfo) => {
    await start(page);
    await createNote(page, 'Backed up note', 'important', ['keep']);
    await page.getByTestId('add-reminder').click();
    await page.getByTestId('preset-Next week').click();
    await page.goto('/settings');

    const download = page.waitForEvent('download');
    await page.getByTestId('backup-export').click();
    const file = testInfo.outputPath('backup.json');
    await (await download).saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(backup.format).toBe('stash-backup');
    expect(backup.tables.items).toHaveLength(1);
    expect(backup.tables.reminders).toHaveLength(1);

    await page.getByTestId('erase-all').click();
    await expect(page.getByTestId('dialog-confirm')).toBeDisabled();
    await page.getByTestId('dialog-input').fill('ERASE');
    await confirmDialog(page);
    await expect(page.getByTestId('toast')).toContainText('All data erased');
    await goHome(page);
    await expect(page.getByText('Your stash is empty')).toBeVisible();

    await page.goto('/settings');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('backup-import').click();
    await (await chooser).setFiles(file);
    await expect(page.getByTestId('dialog')).toContainText('1 item');
    await confirmDialog(page);
    await expect(page.getByTestId('toast')).toContainText('Restored 1 item');
    await goHome(page);
    await expect(cards(page)).toHaveCount(1);
    await page.getByTestId('search-input').fill('keep');
    await expect(cards(page)).toHaveCount(1);
    await page.goto('/reminders');
    await expect(page.getByText('Backed up note')).toBeVisible();
  });

  test('invalid backup files are rejected without changing data', async ({ page }, testInfo) => {
    await start(page);
    await createNote(page, 'Still here');
    const bad = testInfo.outputPath('bad.json');
    fs.writeFileSync(bad, '{"format":"something-else"}');
    await page.goto('/settings');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('backup-import').click();
    await (await chooser).setFiles(bad);
    await expect(page.getByTestId('toast')).toContainText('not a Stash backup');
    await goHome(page);
    await expect(cards(page)).toHaveCount(1);
  });

  test('light, dark and system themes apply and persist', async ({ page }) => {
    await start(page);
    const bg = () => page.getByTestId('home-screen').evaluate((el) => getComputedStyle(el).backgroundColor);
    const lightBg = await bg();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('theme-dark').click();
    // Navigate in-app (no reload) so the setting write is not interrupted.
    await page.goBack();
    await expect.poll(bg).not.toBe(lightBg);
    const darkBg = await bg();
    await page.reload();
    await expect.poll(bg).toBe(darkBg);

    await page.goto('/settings');
    await page.getByTestId('theme-system').click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await goHome(page);
    expect(await bg()).toBe(darkBg);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(bg).toBe(lightBg);
  });
});

test.describe('navigation and accessibility', () => {
  test('browser back returns to the previous screen', async ({ page }) => {
    await start(page);
    await createNote(page, 'Back nav');
    await page.getByTestId('detail-edit').click();
    await expect(page.getByTestId('input-title')).toHaveValue('Back nav');
    await page.goBack();
    await expect(page.getByTestId('detail-title')).toHaveText('Back nav');
  });

  test('leaving the editor with unsaved changes asks first', async ({ page }) => {
    await start(page);
    await page.getByTestId('fab-add').click();
    await page.getByTestId('add-note').click();
    await page.getByTestId('input-title').fill('Draft that matters');
    const headerBack = page.getByRole('link', { name: /back/i }).last();
    await headerBack.click();
    await expect(page.getByTestId('dialog')).toContainText('Discard changes?');
    await page.getByTestId('dialog-cancel').click();
    await expect(page.getByTestId('input-title')).toHaveValue('Draft that matters');
    await headerBack.click();
    await confirmDialog(page);
    await expect(page.getByTestId('search-input')).toBeVisible();
    await expect(page.getByText('Your stash is empty')).toBeVisible();

    // Saving never prompts.
    await createNote(page, 'Saved without prompt');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
  });

  test('icon-only buttons have accessible names and markup is valid', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    await start(page);
    await createNote(page, 'A11y', 'body', ['one', 'two']);
    await page.getByTestId('edit-tags').click();
    await expect(page.getByLabel('Remove #one')).toBeVisible();
    await page.goto('/collections');
    await page.getByTestId('collection-create-empty').click();
    await page.getByTestId('dialog-input').fill('Box');
    await confirmDialog(page);
    await goHome(page);
    for (const name of ['Reminders', 'Settings', 'Add item', 'Add to favorites', 'Search']) {
      await expect(page.getByLabel(name).first()).toBeVisible();
    }
    expect(consoleErrors.filter((e) => /nested|cannot contain|cannot be a descendant/i.test(e))).toEqual([]);
  });

  test('unknown routes show a not-found screen', async ({ page }) => {
    await start(page);
    await page.goto('/does-not-exist');
    await expect(page.getByText("This page doesn't exist")).toBeVisible();
    await page.getByText('Go to library').click();
    await expect(page.getByTestId('search-input')).toBeVisible();
  });

  test('deleted item URL shows a friendly message', async ({ page }) => {
    await start(page);
    await page.goto('/item/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Item not found')).toBeVisible();
  });
});
