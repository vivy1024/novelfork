export function parseNamedArg(argv: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function firstPositionalArg(argv: readonly string[]): string | undefined {
  return argv.slice(2).find((arg) => !arg.startsWith("-"));
}

export function resolveStartupRoot(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  defaultRoot: () => string,
): string {
  return parseNamedArg(argv, "--root")
    ?? firstPositionalArg(argv)
    ?? env.NOVELFORK_PROJECT_ROOT
    ?? defaultRoot();
}

export function resolveStartupPort(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): number {
  return parseInt(
    parseNamedArg(argv, "--port")
      ?? env.NOVELFORK_STUDIO_PORT
      ?? "4567",
    10,
  );
}
