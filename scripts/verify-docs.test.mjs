import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const verifyDocsScript = path.join(repoRoot, 'scripts', 'verify-docs.ts');

function createDocsFixture(extraCurrentDocBody) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'novelfork-docs-verify-'));
  const docsRoot = path.join(root, 'docs');
  const currentDir = path.join(docsRoot, '01-当前状态');
  mkdirSync(currentDir, { recursive: true });

  writeFileSync(
    path.join(docsRoot, 'README.md'),
    `# Fixture Docs\n\n**版本**: v1.0.0\n**创建日期**: 2026-05-07\n**更新日期**: 2026-05-07\n**状态**: ✅ 当前有效\n**文档类型**: current\n\n## 目录导航\n\n- [01-当前状态](01-当前状态/)\n`,
    'utf-8',
  );

  writeFileSync(
    path.join(currentDir, 'README.md'),
    `# 当前状态\n\n**版本**: v1.0.0\n**创建日期**: 2026-05-07\n**更新日期**: 2026-05-07\n**状态**: ✅ 当前有效\n**文档类型**: current\n\n## 文件列表\n\n- [01-能力声明.md](./01-能力声明.md)\n`,
    'utf-8',
  );

  writeFileSync(
    path.join(currentDir, '01-能力声明.md'),
    `# 能力声明\n\n**版本**: v1.0.0\n**创建日期**: 2026-05-07\n**更新日期**: 2026-05-07\n**状态**: ✅ 当前有效\n**文档类型**: current\n\n${extraCurrentDocBody}\n`,
    'utf-8',
  );

  return root;
}

function runVerifyDocs(cwd) {
  return spawnSync(process.execPath, [verifyDocsScript], {
    cwd,
    encoding: 'utf-8',
  });
}

test('rejects unqualified Claude/Codex or novel completion claims without status or end-to-end evidence', () => {
  const root = createDocsFixture('Claude Code CLI 完整对标已完成，/novel:write-next 真实可用。');
  try {
    const result = runVerifyDocs(root);

    assert.notEqual(result.status, 0, `expected docs verify to fail, stdout=${result.stdout} stderr=${result.stderr}`);
    assert.match(result.stderr, /e2e-evidence-claim/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('allows Claude/Codex or novel claims when explicit status or end-to-end evidence is present', () => {
  const root = createDocsFixture('Claude Code CLI 对标状态：`partial`。/novel:write-next 已有 Studio E2E 证据：`e2e/write-next.spec.ts`。');
  try {
    const result = runVerifyDocs(root);

    assert.equal(result.status, 0, `expected docs verify to pass, stdout=${result.stdout} stderr=${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
