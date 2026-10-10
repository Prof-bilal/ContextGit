export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
  manual?: boolean;
  supported?: boolean;
  releaseUrl?: string;
}

export const UPDATE_RELEASE_URL = "https://github.com/Prof-bilal/ContextGit/releases";

/** A small semver comparison that also handles the beta versions we publish. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core, prerelease = ""] = value.replace(/^v/, "").split("-");
    const numbers = core.split(".").map(part => Number.parseInt(part, 10) || 0);
    return { numbers: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0], prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

export function isBetaVersion(version: string): boolean {
  return version.includes("-");
}

export function isLinuxPackageManagerInstall(platform: NodeJS.Platform, appImage?: string): boolean {
  return platform === "linux" && !appImage;
}
