import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BookManagementPage } from "./BookManagementPage";
import type { RuntimeBookArchiveImportResult, RuntimeBookArchiveModule } from "../runtime/product-contract";

afterEach(cleanup);

const MODULES: RuntimeBookArchiveModule[] = [
  { id: "chapters", label: "正文", description: "章节正文" },
  { id: "jingwei", label: "经纬", description: "经纬条目" },
  { id: "narrative", label: "叙事记忆", description: "事实与事件" },
];

function renderPage(overrides: Partial<Parameters<typeof BookManagementPage>[0]> = {}) {
  return render(
    <BookManagementPage
      books={[{ id: "book-1", title: "长夜" }]}
      loading={false}
      error={null}
      onNavigateToBook={vi.fn()}
      onCreateBook={vi.fn()}
      onClaimLegacyBook={vi.fn()}
      onRepairBook={vi.fn()}
      onRebindBookWorkspace={vi.fn()}
      onDeleteBook={vi.fn()}
      loadArchiveModules={async () => MODULES}
      {...overrides}
    />,
  );
}

describe("书架上的项目档案入口", () => {
  it("导出档案：默认全选模块，可取消勾选后导出", async () => {
    const onExportBookArchive = vi.fn(async () => undefined);
    renderPage({ onExportBookArchive, onImportBookArchive: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "导出档案" }));
    const narrative = await screen.findByLabelText(/叙事记忆/);
    expect((narrative as HTMLInputElement).checked).toBe(true);
    fireEvent.click(narrative);
    fireEvent.click(screen.getAllByRole("button", { name: "导出档案" }).at(-1)!);

    await waitFor(() => expect(onExportBookArchive).toHaveBeenCalledWith("book-1", ["chapters", "jingwei"]));
    expect(await screen.findByText(/《长夜》的项目档案已生成/)).not.toBeNull();
  });

  it("导入档案：只能导入为新书，完成后展示导入报告", async () => {
    const result: RuntimeBookArchiveImportResult = {
      operation: { id: "op-1", bookId: "长夜-12345678", state: "ready" },
      report: {
        sourceBookId: "book-1",
        bookId: "长夜-12345678",
        title: "长夜",
        exportedAt: "2026-09-29T08:00:00.000Z",
        sourceNovelforkVersion: "0.0.4",
        modules: [
          { id: "chapters", label: "正文", status: "imported", files: 3, rows: 2 },
          { id: "jingwei", label: "经纬", status: "not-in-archive", files: 0, rows: 0 },
        ],
        items: [
          { severity: "missing", target: "叙述者会话与消息", explanation: "叙述者会话属于 Runtime，不在本档案范围。" },
          { severity: "unrecoverable", target: "questionnaire_response（1 行）", explanation: "引用了本机不存在的共享数据。" },
        ],
        idRemap: { bookId: { from: "book-1", to: "长夜-12345678" }, remapped: 12, kept: 0, renamedOnCollision: 0 },
      },
    };
    const onImportBookArchive = vi.fn(async () => result);
    const onNavigateToBook = vi.fn();
    renderPage({ onImportBookArchive, onExportBookArchive: vi.fn(), onNavigateToBook });

    fireEvent.click(screen.getByRole("button", { name: "导入档案" }));
    expect(await screen.findByText(/只能导入为新书/)).not.toBeNull();
    const file = new File([new Uint8Array([80, 75, 5, 6])], "长夜.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("档案文件"), { target: { files: [file] } });
    await screen.findByLabelText(/经纬/);
    fireEvent.click(screen.getByRole("button", { name: "导入为新书" }));

    await waitFor(() => expect(onImportBookArchive).toHaveBeenCalledWith(file, ["chapters", "jingwei", "narrative"]));
    expect(await screen.findByTestId("book-archive-import-report")).not.toBeNull();
    expect(screen.getByText("叙述者会话与消息")).not.toBeNull();
    expect(screen.getByText("引用了本机不存在的共享数据。")).not.toBeNull();
    expect(screen.getByText("档案中没有")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开工作台" }));
    expect(onNavigateToBook).toHaveBeenCalledWith("长夜-12345678");
  });

  it("没有注入档案回调时不显示入口", () => {
    render(
      <BookManagementPage
        books={[{ id: "book-1", title: "长夜" }]}
        loading={false}
        error={null}
        onNavigateToBook={vi.fn()}
        onCreateBook={vi.fn()}
        onClaimLegacyBook={vi.fn()}
        onRepairBook={vi.fn()}
        onRebindBookWorkspace={vi.fn()}
        onDeleteBook={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "导出档案" })).toBeNull();
    expect(screen.queryByRole("button", { name: "导入档案" })).toBeNull();
  });
});
