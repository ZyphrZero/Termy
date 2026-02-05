declare module 'electron' {
  export interface Shell {
    openExternal: (url: string, options?: { activate?: boolean }) => Promise<void>;
    openPath: (path: string) => Promise<string>;
  }

  export const shell: Shell;
}
