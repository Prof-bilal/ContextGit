import type { PromptVersion } from "../../mock/chat";
import { Chip } from "../primitives";

export interface ImageTile {
  seed: number | null;
  model: string;
  /** A data URL or remote URL returned by the image provider. */
  src?: string | null;
}

/**
 * Image lab: the *prompt* is the versioned artifact, tiles are the output the
 * image provider actually rendered.
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
        {tiles.map((tile, index) => (
          <figure key={`${tile.model}-${tile.seed ?? index}-${index}`} className="cg-tile">
            {tile.src ? (
              <img className="cg-tile-art" src={tile.src} alt="" />
            ) : (
              <div className="cg-tile-art" data-empty="true" aria-hidden="true" />
            )}
            <figcaption>
              {tile.seed !== null ? `seed ${tile.seed}` : tile.model}
            </figcaption>
          </figure>
        ))}
      </div>

      <p className="cg-empty-note">
        The prompt history is the artifact; tiles are what the image provider actually rendered.
      </p>
    </section>
  );
}
