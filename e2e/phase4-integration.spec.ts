import { test, expect } from '@playwright/test';

test.describe('Phase 4 Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test.describe('1. Dashboard', () => {
    test('should display dashboard', async ({ page }) => {
      // Dashboard 是默认首页，应该直接可见
      const dashboard = page.locator('text=书籍列表').or(page.locator('text=Dashboard'));
      await expect(dashboard).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('2. Sidebar Navigation', () => {
    test('should display sidebar', async ({ page }) => {
      // 侧边栏应该在首页可见
      const sidebar = page.locator('nav').first();
      await expect(sidebar).toBeVisible({ timeout: 10000 });
    });

    test('should have settings button', async ({ page }) => {
      const settingsBtn = page.locator('[data-testid="settings-btn"]');
      await expect(settingsBtn).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('3. Settings Page', () => {
    test('should navigate to settings', async ({ page }) => {
      const settingsBtn = page.locator('[data-testid="settings-btn"]');
      await settingsBtn.click();
      await page.waitForURL(/.*settings/, { timeout: 5000 });

      const settingsForm = page.locator('[data-testid="settings-form"]');
      await expect(settingsForm).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('4. Git Worktree Management', () => {
    test('should navigate to worktree page', async ({ page }) => {
      // 通过 URL 直接导航到 worktree 页面
      await page.goto('/worktree');
      await page.waitForLoadState('networkidle');

      const worktreePanel = page.locator('[data-testid="worktree-panel"]');
      await expect(worktreePanel).toBeVisible({ timeout: 10000 });
    });

    test('should show create worktree button', async ({ page }) => {
      await page.goto('/worktree');
      await page.waitForLoadState('networkidle');

      const createBtn = page.locator('[data-testid="create-worktree-btn"]');
      await expect(createBtn).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('5. Admin Panel', () => {
    test('should navigate to admin page', async ({ page }) => {
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');

      const adminPanel = page.locator('[data-testid="admin-panel"]');
      await expect(adminPanel).toBeVisible({ timeout: 10000 });
    });

    test('should show resource metrics tab', async ({ page }) => {
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');

      // 点击 Resources 标签
      const resourcesTab = page.locator('text=Resources').or(page.locator('text=资源'));
      if (await resourcesTab.isVisible()) {
        await resourcesTab.click();
        await page.waitForTimeout(500);
      }

      const metrics = page.locator('[data-testid="resource-metrics"]');
      await expect(metrics).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('6. Global Search', () => {
    test('should open search dialog with keyboard shortcut', async ({ page }) => {
      // 按 Ctrl+Shift+K 打开搜索
      await page.keyboard.press('Control+Shift+K');
      await page.waitForTimeout(500);

      const searchInput = page.locator('[data-testid="global-search-input"]');
      await expect(searchInput).toBeVisible({ timeout: 10000 });
    });

    test('should display search results', async ({ page }) => {
      await page.keyboard.press('Control+Shift+K');
      await page.waitForTimeout(500);

      const searchInput = page.locator('[data-testid="global-search-input"]');
      await searchInput.fill('test');
      await page.waitForTimeout(1000);

      const searchResults = page.locator('[data-testid="search-results"]');
      await expect(searchResults).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('7. Config Page', () => {
    test('should navigate to config page', async ({ page }) => {
      await page.goto('/config');
      await page.waitForLoadState('networkidle');

      // 配置页面应该显示
      const configPage = page.locator('text=配置').or(page.locator('text=Config'));
      await expect(configPage).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('8. Chat Interface', () => {
    test('should display chat interface', async ({ page }) => {
      // 查找聊天按钮并点击
      const chatBtn = page.locator('button').filter({ hasText: /聊天|Chat/i }).first();
      if (await chatBtn.isVisible()) {
        await chatBtn.click();
        await page.waitForTimeout(500);

        const chatInterface = page.locator('[data-testid="chat-interface"]');
        await expect(chatInterface).toBeVisible({ timeout: 10000 });
      }
    });
  });

  test.describe('9. Responsive Layout', () => {
    test('should render on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // 页面应该正常渲染
      const body = page.locator('body');
      await expect(body).toBeVisible({ timeout: 10000 });
    });

    test('should render on desktop viewport', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const body = page.locator('body');
      await expect(body).toBeVisible({ timeout: 10000 });
    });
  });
});
