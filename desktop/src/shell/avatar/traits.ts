/**
 * Deterministic identity for a clay blob. No randomness at runtime: the same
 * seed always produces the same creature, so an agent never "changes face"
 * between renders.
 *
 * Everything is drawn in a 0..100 viewBox: one soft blob body (cx 50, cy 52)
 * with a face on it, an optional topping, and optional blush.
 */
import type { NamedAgent } from "../../mock/fixtures";

export type AvatarState = "idle" | "thinking" | "working" | "done" | "paused" | "error";

export interface AvatarTraits {
  /** 0 round · 1 squircle · 2 egg · 3 lumpy · 4 squat · 5 drop */
  shape: 0 | 1 | 2 | 3 | 4 | 5;
  /** 0 none · 1 tuft · 2 ears · 3 antenna · 4 hat */
  topping: 0 | 1 | 2 | 3 | 4;
  /** 0 dot · 1 wide · 2 sleepy */
  eyes: 0 | 1 | 2;
  blush: boolean;
  eyeGap: number;
  eyeSize: number;
  eyeY: number;
  mouth: boolean;
}

/** FNV-1a — tiny, stable, dependency-free. */
function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function traitsFor(seed: string): AvatarTraits {
  const value = hash(seed);
  const pick = (shift: number, mod: number) => (value >>> shift) % mod;

  return {
    shape: (value % 6) as AvatarTraits["shape"],
    // Most blobs wear something; bare is the exception.
    topping: pick(3, 100) < 30 ? 0 : ((1 + pick(7, 4)) as AvatarTraits["topping"]),
    eyes: pick(11, 3) as AvatarTraits["eyes"],
    blush: ((value >>> 15) & 1) === 1,
    eyeGap: 16 + pick(17, 3) * 4, // 16 / 20 / 24
    eyeSize: 5.5 + pick(20, 3) * 1.2, // 5.5 / 6.7 / 7.9
    eyeY: 44 + pick(23, 3) * 3, // 44 / 47 / 50
    mouth: pick(26, 4) !== 0, // 3 of 4 have a mouth
  };
}

/** Short signature of the drawn traits — used for tests and debugging. */
export function traitSignature(traits: AvatarTraits): string {
  return [
    traits.shape,
    traits.topping,
    traits.eyes,
    traits.blush ? "b" : "-",
    traits.eyeGap,
    traits.eyeSize.toFixed(1),
    traits.eyeY,
  ].join("-");
}

/** Map real agent state onto the blob's face. */
export function avatarState(agent: NamedAgent): AvatarState {
  if (!agent.routine.enabled) return "paused";
  const latest = agent.runs[0];
  if (!latest) return "idle";
  if (latest.status === "running") return latest.branches.length > 0 ? "working" : "thinking";
  if (latest.status === "error") return "error";
  if (latest.status === "done") return "done";
  return "idle";
}

export const AVATAR_STATE_LABEL: Record<AvatarState, string> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  done: "last run succeeded",
  paused: "paused",
  error: "last run failed",
};

export const AVATAR_SIZE_PX = { sm: 20, md: 32, lg: 88 } as const;
export type AvatarSize = keyof typeof AVATAR_SIZE_PX;

/* --------------------------------------------------------------- geometry --- */

export type Shape =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; rx: number }
  | { kind: "path"; d: string };

/** Body silhouette, drawn in a 0..100 viewBox. */
export function bodyPath(shape: AvatarTraits["shape"]): Shape {
  switch (shape) {
    case 1:
      return { kind: "rect", x: 7, y: 7, w: 86, h: 86, rx: 33 };
    case 2:
      return { kind: "ellipse", cx: 50, cy: 52, rx: 40, ry: 46 };
    case 3:
      return {
        kind: "path",
        d: "M52 6c20 1 38 15 41 34 3 20-11 41-31 48-20 7-43-2-51-21S11 22 30 11c7-4 14-5 22-5z",
      };
    case 4:
      return { kind: "ellipse", cx: 50, cy: 54, rx: 46, ry: 37 };
    case 5:
      return {
        kind: "path",
        d: "M50 5c9 0 18 7 25 18 8 12 13 24 13 34 0 19-17 34-38 34S12 76 12 56c0-10 5-22 13-34C32 12 41 5 50 5z",
      };
    default:
      return { kind: "ellipse", cx: 50, cy: 52, rx: 44, ry: 43 };
  }
}

/** Topping drawn on the crown — never covers the face. */
export function toppingShapes(topping: AvatarTraits["topping"]): Shape[] {
  switch (topping) {
    case 1:
      return [{ kind: "ellipse", cx: 69, cy: 13, rx: 7, ry: 7 }];
    case 2:
      return [
        { kind: "ellipse", cx: 13, cy: 32, rx: 9, ry: 9 },
        { kind: "ellipse", cx: 87, cy: 32, rx: 9, ry: 9 },
      ];
    case 3:
      return [
        { kind: "rect", x: 48, y: 4, w: 4, h: 12, rx: 2 },
        { kind: "ellipse", cx: 50, cy: 5, rx: 4, ry: 4 },
      ];
    case 4:
      return [
        { kind: "ellipse", cx: 50, cy: 20, rx: 30, ry: 16 },
        { kind: "rect", x: 18, y: 20, w: 64, h: 8, rx: 4 },
      ];
    default:
      return [];
  }
}

/** Eye geometry per style; state animations still drive scale/rotation. */
export function eyeRadii(traits: AvatarTraits): { rx: number; ry: number; lid: boolean } {
  if (traits.eyes === 1) return { rx: traits.eyeSize * 1.15, ry: traits.eyeSize * 0.82, lid: false };
  if (traits.eyes === 2) return { rx: traits.eyeSize * 0.95, ry: traits.eyeSize * 0.62, lid: true };
  return { rx: traits.eyeSize, ry: traits.eyeSize, lid: false };
}

/** Mouth per state — small and readable even at 32px. */
export function mouthPath(state: AvatarState, y: number): string | null {
  switch (state) {
    case "paused":
      return `M42 ${y} h16`;
    case "error":
      return `M43 ${y + 3} q7 -5 14 0`;
    case "done":
      return `M42 ${y} q8 7 16 0`;
    case "thinking":
    case "working":
      return `M44 ${y + 1} q6 3 12 0`;
    default:
      return `M43 ${y} q7 5 14 0`;
  }
}
