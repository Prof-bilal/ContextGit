import { useEffect, useState } from "react";
import { LuX, LuFile, LuFolderOpen } from "react-icons/lu";
import type { FileNode } from "@/shared/workspaceFiles";
type Preview = Awaited<
  ReturnType<NonNullable<typeof window.contextgit>["filePreview"]>
>;
export default function FilesPanel({
  project,
  initialPath,
  close,
  terminal,
}: {
  project: string;
  initialPath?: string;
  close: () => void;
  terminal: (path: string) => void;
}) {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [directory, setDirectory] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [previews, setPreviews] = useState<
    Array<Preview & { x: number; y: number }>
  >([]);
  const load = async (path = "") => {
    try {
      setNodes(await window.contextgit!.filesList(project, path));
      setDirectory(path);
    } catch (cause) {
      setError(String(cause));
    }
  };
  useEffect(() => {
    void load();
  }, [project]);
  const search = async () => {
    if (!query.trim()) {
      await load(directory);
      return;
    }
    const queue = [""];
    const matches: FileNode[] = [];
    let visited = 0;
    try {
      while (queue.length && visited++ < 500) {
        const entries = await window.contextgit!.filesList(
          project,
          queue.shift(),
        );
        for (const entry of entries) {
          if (entry.path.toLowerCase().includes(query.toLowerCase()))
            matches.push(entry);
          if (entry.kind === "directory") queue.push(entry.path);
        }
      }
      setNodes(matches.slice(0, 250));
    } catch (cause) {
      setError(String(cause));
    }
  };
  const open = async (path: string) => {
    try {
      const doc = await window.contextgit!.filePreview(project, path);
      setPreviews((current) => [
        ...current.filter((item) => item.path !== path),
        { ...doc, x: 100 + current.length * 24, y: 85 + current.length * 20 },
      ]);
    } catch (cause) {
      setError(String(cause));
    }
  };
  useEffect(() => {
    if (initialPath) void open(initialPath);
  }, [initialPath]);
  return (
    <>
      <aside className="sp-float sp-files">
        <header>
          <h2>Project files</h2>
          <button aria-label="Close files" onClick={close}>
            <LuX />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <input
            aria-label="Find a file"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a file…"
          />
          <button>Search</button>
        </form>
        {error && <p role="alert">{error}</p>}
        <button
          className="sp-back"
          onClick={() => void load(directory.split("/").slice(0, -1).join("/"))}
        >
          ← {directory || "Project root"}
        </button>
        <div className="sp-file-list">
          {nodes.map((node) => (
            <button
              key={node.path}
              onClick={() =>
                void (node.kind === "directory"
                  ? load(node.path)
                  : open(node.path))
              }
            >
              {node.kind === "directory" ? <LuFolderOpen /> : <LuFile />}{" "}
              {node.name}
            </button>
          ))}
        </div>
      </aside>
      {previews.map((doc) => (
        <section
          key={doc.path}
          className="sp-file-preview"
          style={{ left: doc.x, top: doc.y }}
        >
          <header
            onPointerDown={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.dataset.dx = String(event.clientX - doc.x);
              event.currentTarget.dataset.dy = String(event.clientY - doc.y);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                return;
              const x = event.clientX - Number(event.currentTarget.dataset.dx),
                y = event.clientY - Number(event.currentTarget.dataset.dy);
              setPreviews((current) =>
                current.map((item) =>
                  item.path === doc.path ? { ...item, x, y } : item,
                ),
              );
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          >
            <strong>{doc.path}</strong>
            <button
              onClick={() =>
                setPreviews((current) =>
                  current.filter((item) => item.path !== doc.path),
                )
              }
              aria-label={`Close ${doc.path}`}
            >
              <LuX />
            </button>
          </header>
          <small>
            {doc.size.toLocaleString()} bytes · {doc.kind} · read only
          </small>
          <div className="sp-file-document">
            {doc.kind === "image" ? (
              <img src={doc.content} alt={doc.path} />
            ) : doc.kind === "markdown" ? (
              <article>
                {doc.content
                  .split("\n")
                  .map((line, index) =>
                    line.startsWith("# ") ? (
                      <h1 key={index}>{line.slice(2)}</h1>
                    ) : line.startsWith("## ") ? (
                      <h2 key={index}>{line.slice(3)}</h2>
                    ) : (
                      <p key={index}>{line || "\u00a0"}</p>
                    ),
                  )}
              </article>
            ) : (
              <pre>
                {doc.content.split("\n").map((line, index) => (
                  <span
                    key={index}
                    className={
                      doc.kind === "diff"
                        ? line.startsWith("+")
                          ? "sp-diff-add"
                          : line.startsWith("-")
                            ? "sp-diff-remove"
                            : ""
                        : ""
                    }
                  >
                    {line}
                    {"\n"}
                  </span>
                ))}
              </pre>
            )}
          </div>
          <button onClick={() => terminal(doc.path)}>Open in terminal</button>
        </section>
      ))}
    </>
  );
}
