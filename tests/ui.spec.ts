import { test, expect } from '@playwright/test';

test.describe('PrepSQL UI Checks', () => {
  test('should load the connections page and display primary options', async ({ page }) => {
    // Navigate to the root of the app
    await page.goto('/');

    // Wait for the main heading "Your databases" to be visible
    const heading = page.getByRole('heading', { name: 'Your databases', exact: true });
    await expect(heading).toBeVisible({ timeout: 15000 });

    // Check if the description text is visible
    const description = page.locator('text=Add a Postgres, MySQL or SQLite connection');
    await expect(description).toBeVisible();

    // Verify "Try demo DB" button is visible
    const tryDemoBtn = page.getByRole('button', { name: 'Try demo DB' });
    await expect(tryDemoBtn).toBeVisible();

    // Verify "New connection" button is visible
    const newConnectionBtn = page.getByRole('button', { name: 'New connection' });
    await expect(newConnectionBtn).toBeVisible();
  });
});
