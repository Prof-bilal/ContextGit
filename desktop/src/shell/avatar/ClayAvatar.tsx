import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import {
  AVATAR_SIZE_PX,
  bodyPath,
  eyeRadii,
  mouthPath,
  toppingShapes,
  traitSignature,
  traitsFor,
  type AvatarSize,
  type AvatarState,
  type Shape,
} from "./traits";

/** One shared visibility listener instead of one per avatar. */
let documentVisible = typeof document === "undefined" ? true : document.visibilityState === "visible";
const watchers = new Set<(visible: boolean) => void>();
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    documentVisible = document.visibilityState === "visible";
    watchers.forEach((notify) => notify(documentVisible));
  });
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(documentVisible);
  useEffect(() => {
    watchers.add(setVisible);
    return () => {
      watchers.delete(setVisible);
    };
  }, []);
  return visible;
}

function ShapeEl({ shape, fill, opacity }: { shape: Shape; fill: string; opacity?: number }): ReactNode {
  if (shape.kind === "ellipse") {
    return (
      <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={fill} opacity={opacity} />
    );
  }
  if (shape.kind === "rect") {
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={shape.rx}
        fill={fill}
        opacity={opacity}
      />
    );
  }
  return <path d={shape.d} fill={fill} opacity={opacity} />;
}

/**
 * A deterministic clay blob per agent: one soft body, a face, an optional topping
 * and blush. Three shading planes only (highlight / base / occluded rim) so it
 * reads as soft clay on the dark surface, and every animation is transform or
 * opacity so a rail full of them stays cheap.
 */
export default function ClayAvatar({
  seed,
  hue,
  state,
  size = "md",
  label,
}: {
  seed: string;
  /** Agent colour token key, e.g. "claude" → var(--cg-agent-claude). */
  hue: string;
  state: AvatarState;
  size?: AvatarSize;
  label?: string;
}) {
  const uid = useId().replace(/[:]/g, "");
  const traits = useMemo(() => traitsFor(seed), [seed]);
  const visible = useDocumentVisible();
  const px = AVATAR_SIZE_PX[size];
  const detailed = size !== "sm";

  const gradientId = `clay-${uid}`;
  const body = bodyPath(traits.shape);
  const toppings = toppingShapes(traits.topping);
  const { rx, ry, lid } = eyeRadii(traits);
  const mouth = mouthPath(state, traits.eyeY + 15);
  const eyeLeft = 50 - traits.eyeGap / 2;
  const eyeRight = 50 + traits.eyeGap / 2;

  const style: CSSProperties & Record<string, string> = {
    width: `${px}px`,
    height: `${px}px`,
    "--hue": `var(--cg-agent-${hue})`,
    "--clay-base": "color-mix(in srgb, var(--hue) 42%, var(--cg-surface-3))",
    "--clay-hi": "color-mix(in srgb, var(--clay-base) 72%, var(--cg-ink))",
    "--clay-lo": "color-mix(in srgb, var(--clay-base) 60%, var(--cg-bg))",
    "--clay-top": "color-mix(in srgb, var(--clay-base) 58%, var(--cg-bg))",
  };

  return (
    <span
      className="cg-clay-wrap"
      data-seed={seed}
      data-variant={traitSignature(traits)}
      style={style}
    >
      <svg
        viewBox="0 0 100 100"
        width={px}
        height={px}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        focusable="false"
      >
        <defs>
          <radialGradient id={gradientId} cx="34%" cy="26%" r="80%">
            <stop offset="0%" stopColor="var(--clay-hi)" />
            <stop offset="58%" stopColor="var(--clay-base)" />
            <stop offset="100%" stopColor="var(--clay-lo)" />
          </radialGradient>
        </defs>

        <g className="cg-clay" data-state={state} data-size={size} data-paused={!visible}>
          <ShapeEl shape={body} fill={`url(#${gradientId})`} />

          {/* topping sits on the crown, above the face */}
          {toppings.map((shape, index) => (
            <ShapeEl key={index} shape={shape} fill="var(--clay-top)" />
          ))}

          {detailed && traits.blush && (
            <g className="cg-clay-blush">
              <ellipse cx={eyeLeft - 7} cy={traits.eyeY + 13} rx={6.5} ry={3.6} />
              <ellipse cx={eyeRight + 7} cy={traits.eyeY + 13} rx={6.5} ry={3.6} />
            </g>
          )}

          <g className="cg-clay-face">
            <ellipse
              className="cg-clay-eye cg-clay-eye--l"
              cx={eyeLeft}
              cy={traits.eyeY}
              rx={rx}
              ry={ry}
            />
            <ellipse
              className="cg-clay-eye cg-clay-eye--r"
              cx={eyeRight}
              cy={traits.eyeY}
              rx={rx}
              ry={ry}
            />
            {lid && (
              <g className="cg-clay-lids">
                <path d={`M${eyeLeft - rx} ${traits.eyeY - ry} h${rx * 2}`} />
                <path d={`M${eyeRight - rx} ${traits.eyeY - ry} h${rx * 2}`} />
              </g>
            )}
            {traits.mouth && mouth && <path className="cg-clay-mouth" d={mouth} />}
          </g>
        </g>
      </svg>
    </span>
  );
}
