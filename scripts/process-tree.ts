/**
 * 结束一个子进程及其全部后代（隔离验证实例用）。
 *
 * Windows 上 `child.kill()` 只结束直接子进程：`bun run main.ts` 再拉起的进程会成为孤儿，
 * 继续占着端口与数据目录里的数据库文件，数据目录也就删不掉。这里改用 `taskkill /T /F` 结束整棵树。
 * 参数以数组交给 Bun.spawnSync，不经过 shell，Git Bash（MSYS）不会把 `/T` 改写成路径。
 * POSIX 上先结束直接子进程的后代（pkill -P），再结束子进程本身。
 */

export function processTreeKillCommands(pid: number, platform: NodeJS.Platform = process.platform): string[][] {
	if (!Number.isSafeInteger(pid) || pid <= 0) return [];
	if (platform === "win32") return [["taskkill", "/T", "/F", "/PID", String(pid)]];
	return [
		["pkill", "-KILL", "-P", String(pid)],
		["kill", "-KILL", String(pid)],
	];
}

/** 尽力结束整棵进程树；进程已经不在时命令会失败，忽略即可。 */
export function killProcessTree(pid: number, platform: NodeJS.Platform = process.platform): void {
	for (const command of processTreeKillCommands(pid, platform)) {
		try {
			Bun.spawnSync(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
		} catch {
			// 命令不存在或进程已退出：继续下一条。
		}
	}
}
