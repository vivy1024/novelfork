import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_USERPROFILE = process.env.USERPROFILE;

describe("onboarding status route", () => {
  let homeDir: string;
  let root: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "novelfork-onboarding-home-"));
    root = await mkdtemp(join(tmpdir(), "novelfork-onboarding-project-"));
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME;
    process.env.USERPROFILE = ORIGINAL_USERPROFILE;
    await rm(homeDir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  async function createRoute() {
    const [{ StateManager }, { createOnboardingRouter }] = await Promise.all([
      import("@vivy1024/novelfork-core"),
      import("./onboarding"),
    ]);

    return createOnboardingRouter({
      state: new StateManager(root),
      root,
      broadcast: vi.fn(),
      buildPipelineConfig: vi.fn(),
      getSessionLlm: vi.fn(),
      runStore: {} as never,
      getStartupSummary: () => null,
      setStartupSummary: vi.fn(),
      setStartupRecoveryRunner: vi.fn(),
    } as never);
  }

  it("returns default onboarding status without treating missing model config as fatal", async () => {
    const app = await createRoute();

    const response = await app.request("http://localhost/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        dismissedFirstRun: false,
        dismissedGettingStarted: false,
        provider: {
          hasUsableModel: false,
        },
        tasks: {
          modelConfigured: false,
          hasAnyBook: false,
          hasOpenedJingwei: false,
          hasAnyChapter: false,
          hasTriedAiWriting: false,
          hasTriedAiTasteScan: false,
          hasReadWorkbenchIntro: false,
        },
      },
    });
  });

  it("persists dismissed flags and user-completed onboarding tasks", async () => {
    let app = await createRoute();

    const patch = await app.request("http://localhost/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dismissedFirstRun: true,
        dismissedGettingStarted: true,
        tasks: {
          hasOpenedJingwei: true,
          hasReadWorkbenchIntro: true,
        },
      }),
    });

    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({
      status: {
        dismissedFirstRun: true,
        dismissedGettingStarted: true,
        tasks: {
          hasOpenedJingwei: true,
          hasReadWorkbenchIntro: true,
        },
      },
    });

    app = await createRoute();
    const response = await app.request("http://localhost/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        dismissedFirstRun: true,
        dismissedGettingStarted: true,
        tasks: {
          hasOpenedJingwei: true,
          hasReadWorkbenchIntro: true,
        },
      },
    });
  });

  it("derives model, book, and chapter task state from current runtime state", async () => {
    const [{ providerManager }] = await Promise.all([
      import("../lib/provider-manager"),
    ]);
    providerManager.initialize();
    providerManager.updateProvider("openai", {
      config: { apiKey: "sk-test-1234567890" },
    });

    const bookDir = join(root, "books", "first-book");
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await writeFile(join(bookDir, "book.json"), JSON.stringify({ id: "first-book", title: "第一本书" }), "utf-8");
    await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify([{ number: 1, title: "第一章" }]), "utf-8");

    const app = await createRoute();
    const response = await app.request("http://localhost/status");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: {
        provider: {
          hasUsableModel: true,
          defaultProvider: "openai",
          defaultModel: "gpt-4-turbo",
        },
        tasks: {
          modelConfigured: true,
          hasAnyBook: true,
          hasAnyChapter: true,
        },
      },
    });
  });
});
