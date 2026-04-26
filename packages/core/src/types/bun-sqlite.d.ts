declare module "bun:sqlite" {
  export interface Changes {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
  }

  export class Statement<T = unknown> {
    all(...params: unknown[]): T[];
    get(...params: unknown[]): T | undefined;
    run(...params: unknown[]): Changes;
    values(...params: unknown[]): unknown[][];
  }

  export interface DatabaseOptions {
    readonly?: boolean;
    create?: boolean;
    readwrite?: boolean;
  }

  export class Database {
    constructor(filename?: string, options?: DatabaseOptions);
    exec(sql: string): void;
    prepare<T = unknown>(sql: string): Statement<T>;
    query<T = unknown>(sql: string): Statement<T>;
    run(sql: string, ...params: unknown[]): Changes;
    transaction<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult): (...args: TArgs) => TResult;
    close(): void;
  }
}
