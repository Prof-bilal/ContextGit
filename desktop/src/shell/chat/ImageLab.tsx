import type { PromptVersion } from "../../mock/chat";
import { Chip } from "../primitives";

export interface ImageTile {
  seed: number;
  model: string;
}

/**
 * Image lab: the *prompt* is the versioned artifact, tiles are the output.
 * No image provider is wired here — the tiles are placeholders.
 */
export default function ImageLab({
  versions,
  tiles,
  model,
  aspect,
}: {
  versions: PromptVersion[];
  tiles: ImageTile[];
  model: string;
  aspect: string;
}) {
  const latest = versions[versions.length - 1];
  return (
    <section className="cg-block cg-image" aria-label="Image lab">
      <header className="cg-block-head">
        <span className="cg-kicker">Image lab</span>
        <span className="cg-view-sub">
          {model} · {aspect}
        </span>
        <Chip>
          v{latest?.version ?? 1} · {versions.length} prompt version
          {versions.length === 1 ? "" : "s"}
        </Chip>
      </header>

      <ol className="cg-versions" aria-label="Prompt history">
        {versions.map((version) => (
          <li
            key={version.version}
            className="cg-version"
            data-current={version.version === latest?.version}
          >
            <span className="cg-version-tag">v{version.version}</span>
            <span className="cg-version-copy">
              <strong>{version.text}</strong>
              <span>{version.note}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="cg-tiles" data-count={tiles.length}>
        {tiles.map((tile) => (
          <figure key={tile.seed} className="cg-tile">
            <div className="cg-tile-art" aria-hidden="true" />
            <figcaption>seed {tile.seed}</figcaption>
          </figure>
        ))}
      </div>

      <p className="cg-empty-note">
        Placeholder tiles — the mock calls no image model. The prompt history is the real artifact.
      </p>
    </section>
  );
}
