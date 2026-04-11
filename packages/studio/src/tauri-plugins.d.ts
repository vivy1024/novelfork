declare module "@tauri-apps/plugin-updater" {
  interface UpdateResult {
    readonly version: string;
    readonly body: string | null;
    downloadAndInstall(
      onProgress?: (event: {
        event: string;
        data: { chunkLength: number; contentLength?: number };
      }) => void,
    ): Promise<void>;
  }
  export function check(): Promise<UpdateResult | null>;
}

declare module "@tauri-apps/plugin-process" {
  export function relaunch(): Promise<void>;
}
