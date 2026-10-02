import { expect, test } from '@playwright/test';

test('dashboard shell renders in demo mode', async ({ page }) => {
  await page.goto('/?demo=true');

  await expect(page).toHaveTitle(/Stellar Agent Guard/i);
  await expect(page.getByRole('heading', { name: /Stellar Agent Guard/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Console' })).toBeVisible();
  await expect(page.getByText(/demo mode/i)).toBeVisible();
});
