import { expect, test } from '@playwright/test';

test('demo-mode page matches the committed visual baseline', async ({ page }) => {
  await page.goto('/?demo=true');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('dashboard-demo.png');
});
