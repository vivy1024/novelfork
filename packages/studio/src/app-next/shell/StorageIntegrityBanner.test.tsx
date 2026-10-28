import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mapRuntimeBootstrap, type RuntimeStorageIntegrityAlert } from "../runtime/product-contract";
import { AgentShell } from "./AgentShell";
import { StorageIntegrityBanner } from "./StorageIntegrityBanner";

afterEach(() => {
  cleanup();
});

const alert: RuntimeStorageIntegrityAlert = {
  code: "STORAGE_INTEGRITY_DAMAGED",
  storageFile: "novelfork.db",
  reportSummary: "*** in database main ***",
  explanation: {
    whatHappened: "启动时对 novelfork.db 做了完整性检查，SQLite 报告这份库已损坏：Page 3 is never used",
    whyItMatters: "这份库保存的是作品书目、章节索引、经纬设定与叙事记忆。",
    suggestedAction: "先停止写作并把「我的作品」里的书导出成档案。",
  },
};

function renderShell(storageIntegrity: RuntimeStorageIntegrityAlert | null, onOpenBooks = vi.fn()) {
  return render(
    <AgentShell
      route={{ kind: "home" }}
      books={[]}
      sessions={[]}
      onNavigate={vi.fn()}
      banner={<StorageIntegrityBanner alert={storageIntegrity} onOpenBooks={onOpenBooks} />}
    >
      <div>画布挂载点</div>
    </AgentShell>,
  );
}

describe("StorageIntegrityBanner", () => {
  it("有告警时在应用外壳顶层显示服务端给的三段式说明与导出指引", () => {
    const onOpenBooks = vi.fn();
    renderShell(alert, onOpenBooks);
    const banner = screen.getByTestId("storage-integrity-banner");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain(alert.explanation.whatHappened);
    expect(banner.textContent).toContain(alert.explanation.whyItMatters);
    expect(banner.textContent).toContain(alert.explanation.suggestedAction);
    expect(banner.textContent).toContain("导出档案");
    // 横幅与路由内容同时存在，不顶替页面。
    expect(screen.getByText("画布挂载点")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "去「我的作品」导出档案" }));
    expect(onOpenBooks).toHaveBeenCalledTimes(1);
  });

  it("没有告警时不渲染", () => {
    renderShell(null);
    expect(screen.queryByTestId("storage-integrity-banner")).toBeNull();
    expect(screen.getByText("画布挂载点")).toBeTruthy();
  });

  it("可以关闭；重新挂载（刷新）后告警仍在就再次出现", () => {
    const first = renderShell(alert);
    fireEvent.click(screen.getByRole("button", { name: "暂时关闭产品库告警" }));
    expect(screen.queryByTestId("storage-integrity-banner")).toBeNull();
    first.unmount();

    renderShell(alert);
    expect(screen.getByTestId("storage-integrity-banner")).toBeTruthy();
  });

  it("关闭后轮询拿到新的告警会再次出现", () => {
    const { rerender } = render(<StorageIntegrityBanner alert={alert} />);
    fireEvent.click(screen.getByRole("button", { name: "暂时关闭产品库告警" }));
    expect(screen.queryByTestId("storage-integrity-banner")).toBeNull();
    rerender(<StorageIntegrityBanner alert={alert} />);
    expect(screen.queryByTestId("storage-integrity-banner")).toBeNull();
    const next = { ...alert, explanation: { ...alert.explanation, whatHappened: "另一条损坏报告" } };
    rerender(<StorageIntegrityBanner alert={next} />);
    expect(screen.getByTestId("storage-integrity-banner").textContent).toContain("另一条损坏报告");
  });
});

describe("mapRuntimeBootstrap 的 storageIntegrity", () => {
  it("带完整三段式说明时原样映射", () => {
    const mapped = mapRuntimeBootstrap({ books: [], narrators: [], storageIntegrity: { ...alert, kind: "persistent" } });
    expect(mapped.storageIntegrity).toEqual(alert);
  });

  it("缺字段、缺说明或为 null 时视为没有告警，不按 code 自造文案", () => {
    expect(mapRuntimeBootstrap({ books: [], narrators: [] }).storageIntegrity).toBeNull();
    expect(mapRuntimeBootstrap({ books: [], narrators: [], storageIntegrity: null }).storageIntegrity).toBeNull();
    expect(
      mapRuntimeBootstrap({
        books: [],
        narrators: [],
        storageIntegrity: { code: "STORAGE_INTEGRITY_DAMAGED", explanation: { whatHappened: "x" } },
      }).storageIntegrity,
    ).toBeNull();
  });
});
