const REQUIRED_THEME_UTILITIES = [
  ".bg-primary",
  ".text-primary",
  ".text-primary-foreground",
  ".bg-muted",
  ".text-muted-foreground",
  ".border-border",
  ".bg-card",
  ".bg-destructive",
];

function normalizeStyleToken(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function buildGroup(snapshot) {
  return [
    normalizeStyleToken(snapshot.backgroundColor),
    normalizeStyleToken(snapshot.color),
    normalizeStyleToken(snapshot.borderColor),
    normalizeStyleToken(snapshot.opacity),
    normalizeStyleToken(snapshot.cursor),
    normalizeStyleToken(snapshot.boxShadow),
  ].join("|");
}

function collectCssText() {
  const chunks = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules ?? [])) {
        chunks.push(rule.cssText);
      }
    } catch {
      // 忽略跨域或浏览器限制的样式表
    }
  }
  return chunks.join("\n");
}

function findMissingUtilities(cssText) {
  return REQUIRED_THEME_UTILITIES.filter((utility) => !cssText.includes(utility));
}

function readSnapshot(element, label) {
  if (!element) {
    throw new Error(`缺少审计目标：${label}`);
  }

  const styles = getComputedStyle(element);
  return {
    id: label,
    label,
    backgroundColor: styles.backgroundColor,
    color: styles.color,
    borderColor: styles.borderColor,
    opacity: styles.opacity,
    cursor: styles.cursor,
    boxShadow: styles.boxShadow,
  };
}

function auditVisualStates({ cssText, snapshots }) {
  const groups = {
    primaryAction: buildGroup(snapshots.primaryAction),
    outlineAction: buildGroup(snapshots.outlineAction),
    activeTab: buildGroup(snapshots.activeTab),
    disabledAction: buildGroup(snapshots.disabledAction),
  };

  const comparisons = {
    primaryVsOutline: { sameGroup: groups.primaryAction === groups.outlineAction },
    activeTabVsOutline: { sameGroup: groups.activeTab === groups.outlineAction },
    disabledVsOutline: { sameGroup: groups.disabledAction === groups.outlineAction },
    disabledVsPrimary: { sameGroup: groups.disabledAction === groups.primaryAction },
  };

  const missingUtilities = findMissingUtilities(cssText);
  const pass =
    missingUtilities.length === 0 &&
    !comparisons.primaryVsOutline.sameGroup &&
    !comparisons.activeTabVsOutline.sameGroup &&
    !comparisons.disabledVsOutline.sameGroup &&
    !comparisons.disabledVsPrimary.sameGroup;

  return {
    pass,
    missingUtilities,
    groups,
    comparisons,
    snapshots,
  };
}

function normalizeButtonText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function findButtonByName(name) {
  return Array.from(document.querySelectorAll("button")).find((button) => normalizeButtonText(button.textContent) === name) ?? null;
}

function findAuditTarget(name) {
  return document.querySelector(`[data-visual-audit="${name}"]`);
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function runNovelForkAppNextVisualAudit() {
  if (!location.pathname.startsWith("/next")) {
    throw new Error(`当前页面不是 /next 路由：${location.pathname}`);
  }

  const importToggle = findAuditTarget("outlineAction") ?? findButtonByName("导入") ?? findButtonByName("取消导入");

  if (!importToggle) {
    throw new Error("找不到 Dashboard 导入按钮，无法建立 active tab / disabled state 审计场景。");
  }

  if (!findAuditTarget("activeTab")) {
    importToggle.click();
    await nextFrame();
  }

  const cssText = collectCssText();

  return auditVisualStates({
    cssText,
    snapshots: {
      primaryAction: readSnapshot(findAuditTarget("primaryAction") ?? findButtonByName("+ 创建新书") ?? findButtonByName("取消"), "primaryAction"),
      outlineAction: readSnapshot(findAuditTarget("outlineAction") ?? importToggle, "outlineAction"),
      activeTab: readSnapshot(findAuditTarget("activeTab") ?? findButtonByName("章节文本"), "activeTab"),
      disabledAction: readSnapshot(findAuditTarget("disabledAction") ?? findButtonByName("导入章节"), "disabledAction"),
    },
  });
}

if (typeof window !== "undefined") {
  window.runNovelForkAppNextVisualAudit = runNovelForkAppNextVisualAudit;
  window.NOVELFORK_REQUIRED_THEME_UTILITIES = REQUIRED_THEME_UTILITIES;
}
