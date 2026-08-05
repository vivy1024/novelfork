import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// SimpleSelect wraps Radix Select, which never opens in jsdom. Render it as a
// native select so the clearance options are assertable.
vi.mock("@/components/ui/simple-select", () => ({
  SimpleSelect: ({ value, onValueChange, options, "aria-label": ariaLabel }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

import type {
  KnowledgeLevel,
  KnowledgeTag,
  UserKnowledgeAcl,
} from "../../runtime-admin/knowledge";
import { UserKnowledgeAclDialog } from "./UserKnowledgeAclDialog";

const levels: KnowledgeLevel[] = [
  { id: "l1", name: "internal", rank: 10, label: "内部" },
  { id: "l2", name: "confidential", rank: 20, label: "机密" },
];

const tags: KnowledgeTag[] = [
  { id: "t1", name: "剧情大纲", controlled: true },
  { id: "t2", name: "运营数据", controlled: false },
];

const currentAcl: UserKnowledgeAcl = {
  clearanceLevel: "internal",
  tagIds: ["t1"],
  reviewTagIds: [],
  canWrite: false,
};

function createApi(acl: UserKnowledgeAcl = currentAcl) {
  return {
    getAcl: vi.fn(async () => acl),
    setAcl: vi.fn(async (_userId: string, input: Record<string, unknown>) => ({
      ...acl,
      ...input,
    }) as unknown as UserKnowledgeAcl),
    listLevels: vi.fn(async () => levels),
    listTags: vi.fn(async () => tags),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UserKnowledgeAclDialog", () => {
  it("读取当前分级、标签与写入权限", async () => {
    const api = createApi();
    render(<UserKnowledgeAclDialog userId="u1" username="alice" onClose={() => {}} api={api} />);

    await waitFor(() => expect(api.getAcl).toHaveBeenCalledWith("u1"));
    expect(api.listLevels).toHaveBeenCalledTimes(1);
    expect(api.listTags).toHaveBeenCalledTimes(1);

    expect(await screen.findByText(/知识库权限 · alice/)).toBeTruthy();
    expect(screen.getByLabelText("可读 剧情大纲").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("可读 运营数据").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText("允许写入").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/分级 internal/)).toBeTruthy();
  });

  it("授予审阅时自动补齐可读权限", async () => {
    const api = createApi();
    render(<UserKnowledgeAclDialog userId="u1" username="alice" onClose={() => {}} api={api} />);
    await screen.findByText(/知识库权限 · alice/);

    // Review implies read; granting review alone would be unsatisfiable.
    fireEvent.click(screen.getByLabelText("可审阅 运营数据"));
    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));

    await waitFor(() => expect(api.setAcl).toHaveBeenCalledTimes(1));
    const input = api.setAcl.mock.calls[0][1] as { tagIds: string[]; reviewTagIds: string[] };
    expect(input.reviewTagIds).toEqual(["t2"]);
    expect(input.tagIds).toEqual(["t1", "t2"]);
  });

  it("撤销可读时同时撤销审阅", async () => {
    const api = createApi({ ...currentAcl, tagIds: ["t1"], reviewTagIds: ["t1"] });
    render(<UserKnowledgeAclDialog userId="u1" username="alice" onClose={() => {}} api={api} />);
    await screen.findByText(/知识库权限 · alice/);

    fireEvent.click(screen.getByLabelText("可读 剧情大纲"));
    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));

    await waitFor(() => expect(api.setAcl).toHaveBeenCalledTimes(1));
    const input = api.setAcl.mock.calls[0][1] as { tagIds: string[]; reviewTagIds: string[] };
    expect(input.tagIds).toEqual([]);
    expect(input.reviewTagIds).toEqual([]);
  });

  it("分级可清空为未授予并按 null 提交", async () => {
    const api = createApi();
    render(<UserKnowledgeAclDialog userId="u1" username="alice" onClose={() => {}} api={api} />);
    await screen.findByText(/知识库权限 · alice/);

    const select = screen.getByLabelText("分级") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(["__none__", "internal", "confidential"]);

    fireEvent.change(select, { target: { value: "__none__" } });
    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));

    await waitFor(() => expect(api.setAcl).toHaveBeenCalledTimes(1));
    expect((api.setAcl.mock.calls[0][1] as { clearanceLevel: unknown }).clearanceLevel).toBeNull();
  });

  it("没有改动时保存按钮保持禁用", async () => {
    const api = createApi();
    render(<UserKnowledgeAclDialog userId="u1" username="alice" onClose={() => {}} api={api} />);
    await screen.findByText(/知识库权限 · alice/);

    expect((screen.getByRole("button", { name: "保存权限" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.setAcl).not.toHaveBeenCalled();
  });

  it("读取失败时给出原因而不是空白对话框", async () => {
    const api = createApi();
    api.getAcl = vi.fn(async () => {
      throw new Error("需要管理员权限");
    });

    render(<UserKnowledgeAclDialog userId="u1" username="alice" onClose={() => {}} api={api} />);

    expect(await screen.findByText("知识库权限操作失败")).toBeTruthy();
    expect(screen.getByText("需要管理员权限")).toBeTruthy();
  });

  it("未选择用户时不请求任何数据", () => {
    const api = createApi();
    render(<UserKnowledgeAclDialog userId={null} username="" onClose={() => {}} api={api} />);

    expect(api.getAcl).not.toHaveBeenCalled();
    expect(screen.queryByText(/知识库权限/)).toBeNull();
  });
});
