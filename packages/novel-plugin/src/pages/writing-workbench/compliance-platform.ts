export type CompliancePlatform = "qidian" | "jjwxc" | "fanqie" | "qimao" | "generic";

/**
 * 将 NovelFork 书籍配置的平台枚举映射为 compliance 引擎的平台枚举。
 * feilu、other 和缺省值没有对应的专用规则包，统一使用 generic。
 */
export function toCompliancePlatform(bookPlatform: string | undefined): CompliancePlatform {
  switch (bookPlatform) {
    case "tomato":
      return "fanqie";
    case "qidian":
      return "qidian";
    default:
      return "generic";
  }
}
