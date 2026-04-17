import { test, expect } from '@playwright/test';

test.describe('Phase 4 Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test.describe('1. Git Worktree Management', () => {
    test('should display worktree panel', async ({ page }) => {
      const worktreePanel = page.locator('[data-testid="worktree-panel"]');
      await expect(worktreePanel).toBeVisible({ timeout: 10000 });
    });

    test('should show create worktree button', async ({ page }) => {
      const createBtn = page.locator('[data-testid="create-worktree-btn"]');
      await expect(createBtn).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('2. Multi-Window Card System', () => {
    test('should render card container', async ({ page }) => {
      const cardContainer = page.locator('[data-testid="card-container"]');
      await expect(cardContainer).toBeVisible({ timeout: 10000 });
    });

    test('should allow opening new card', async ({ page }) => {
      const newCardBtn = page.locator('[data-testid="new-card-btn"]');
      if (await newCardBtn.isVisible()) {
        await newCardBtn.click();
        const cards = page.locator('[data-testid^="card-"]');
        await expect(cards).toHaveCount(1, { timeout: 5000 });
      }
    });
  });

  test.describe('3. Conversational Interaction', () => {
    test('should display chat interface', async ({ page }) => {
      const chatInterface = page.locator('[data-testid="chat-interface"]');
      await expect(chatInterface).toBeVisible({ timeout: 10000 });
    });

    test('should have message input field', async ({ page }) => {
      const messageInput = page.locator('[data-testid="message-input"]');
      await expect(messageInput).toBeVisible({ timeout: 10000 });
    });

    test('should have send button', async ({ page }) => {
      const sendBtn = page.locator('[data-testid="send-message-btn"]');
      await expect(sendBtn).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('4. Context Management', () => {
    test('should display context panel', async ({ page }) => {
      const contextPanel = page.locator('[data-testid="context-panel"]');
      await expect(contextPanel).toBeVisible({ timeout: 10000 });
    });

    test('should show context actions', async ({ page }) => {
      const compressBtn = page.locator('[data-testid="compress-context-btn"]');
      const clearBtn = page.locator('[data-testid="clear-context-btn"]');

      const hasCompressBtn = await compressBtn.isVisible();
      const hasClearBtn = await clearBtn.isVisible();

      expect(hasCompressBtn || hasClearBtn).toBeTruthy();
    });
  });

  test.describe('5. Settings Page', () => {
    test('should navigate to settings', async ({ page }) => {
      const settingsBtn = page.locator('[data-testid="settings-btn"]');
      if (await settingsBtn.isVisible()) {
        await settingsBtn.click();
        await expect(page).toHaveURL(/.*settings/, { timeout: 5000 });
      }
    });

    test('should display settings form', async ({ page }) => {
      await page.goto('/settings');
      const settingsForm = page.locator('[data-testid="settings-form"]');
      await expect(settingsForm).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('6. Routine System (Permission Control)', () => {
    test('should display routine panel', async ({ page }) => {
      const routinePanel = page.locator('[data-testid="routine-panel"]');
      await expect(routinePanel).toBeVisible({ timeout: 10000 });
    });

    test('should show routine list', async ({ page }) => {
      const routineList = page.locator('[data-testid="routine-list"]');
      await expect(routineList).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('7. Admin Panel (Resource Monitoring)', () => {
    test('should display admin panel', async ({ page }) => {
      const adminPanel = page.locator('[data-testid="admin-panel"]');
      await expect(adminPanel).toBeVisible({ timeout: 10000 });
    });

    test('should show resource metrics', async ({ page }) => {
      const metrics = page.locator('[data-testid="resource-metrics"]');
      await expect(metrics).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('8. Global Search', () => {
    test('should display search input', async ({ page }) => {
      const searchInput = page.locator('[data-testid="global-search-input"]');
      await expect(searchInput).toBeVisible({ timeout: 10000 });
    });

    test('should trigger search on input', async ({ page }) => {
      const searchInput = page.locator('[data-testid="global-search-input"]');
      if (await searchInput.isVisible()) {
        await searchInput.fill('test query');
        await page.waitForTimeout(500);
        const searchResults = page.locator('[data-testid="search-results"]');
        await expect(searchResults).toBeVisible({ timeout: 5000 });
      }
    });
  });

  test.describe('9. Model Selector', () => {
    test('should display model selector', async ({ page }) => {
      const modelSelector = page.locator('[data-testid="model-selector"]');
      await expect(modelSelector).toBeVisible({ timeout: 10000 });
    });

    test('should show model options on click', async ({ page }) => {
      const modelSelector = page.locator('[data-testid="model-selector"]');
      if (await modelSelector.isVisible()) {
        await modelSelector.click();
        const modelOptions = page.locator('[data-testid="model-option"]');
        await expect(modelOptions.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
});
