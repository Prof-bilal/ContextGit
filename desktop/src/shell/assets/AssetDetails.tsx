import { useEffect, useState } from "react";
import { LuExternalLink, LuTrash2 } from "react-icons/lu";

import type { Asset, AssetPatch } from "../../../shared/assets";
import { Chip, Field } from "../primitives";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The Assets inspector: metadata plus editable name, folder, tags and note. */
export default function AssetDetails({
  asset,
  folders,
  onUpdate,
  onReveal,
  onDelete,
}: {
  asset: Asset;
  folders: string[];
  onUpdate: (patch: AssetPatch) => Promise<void>;
  onReveal: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [folder, setFolder] = useState(asset.folder);
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [note, setNote] = useState(asset.note);

  useEffect(() => {
    setName(asset.name);
    setFolder(asset.folder);
    setTags(asset.tags.join(", "));
    setNote(asset.note);
  }, [asset.id, asset.name, asset.folder, asset.tags, asset.note]);

  const dirty =
    name !== asset.name ||
    folder !== asset.folder ||
    tags !== asset.tags.join(", ") ||
    note !== asset.note;

  const save = () =>
    void onUpdate({
      name,
      folder,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      note,
    });

  return (
    <>
      <div className="cg-fields">
        <Field label="Kind">
          <Chip>{asset.kind}</Chip>
        </Field>
        <Field label="Size">{formatSize(asset.size)}</Field>
        <Field label="Type">{asset.mime}</Field>
        <Field label="Added">{new Date(asset.added).toLocaleString()}</Field>
      </div>

      <label className="cg-field-label" htmlFor="cg-asset-name">
        Name
      </label>
      <input
        id="cg-asset-name"
        className="cg-input"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />

      <label className="cg-field-label" htmlFor="cg-asset-folder">
        Folder
      </label>
      <select
        id="cg-asset-folder"
        className="cg-input"
        value={folder}
        onChange={(event) => setFolder(event.target.value)}
      >
        <option value="">(root)</option>
        {folders.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
        {folder && !folders.includes(folder) && <option value={folder}>{folder}</option>}
      </select>

      <label className="cg-field-label" htmlFor="cg-asset-tags">
        Tags (comma separated)
      </label>
      <input
        id="cg-asset-tags"
        className="cg-input"
        value={tags}
        placeholder="hero, marketing, v2"
        onChange={(event) => setTags(event.target.value)}
      />

      <label className="cg-field-label" htmlFor="cg-asset-note">
        Note
      </label>
      <textarea
        id="cg-asset-note"
        className="cg-input"
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <div className="cg-dock-actions">
        <button
          type="button"
          className="cg-btn"
          data-variant="primary"
          disabled={!dirty}
          onClick={save}
        >
          Save
        </button>
        <button type="button" className="cg-btn" onClick={onReveal}>
          <LuExternalLink aria-hidden="true" /> Reveal
        </button>
        <button type="button" className="cg-btn" data-variant="danger" onClick={onDelete}>
          <LuTrash2 aria-hidden="true" /> Delete
        </button>
      </div>
    </>
  );
}
