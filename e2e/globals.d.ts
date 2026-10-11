declare global {
  interface Window {
    contextgit?: {
      apiBase: string;
      apiToken: string;
      restartBackend: () => Promise<unknown>;
    };
    isolation: {
      fault: (fault: { id: string; region: string } | null) => void;
      resourceCrash: (crash: boolean) => void;
      terminalMounts: number;
    };
  }
}

export {};
