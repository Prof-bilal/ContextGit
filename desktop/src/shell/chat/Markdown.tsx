import { Fragment, useMemo, type ReactNode } from "react";

/**
 * The transcript's markdown renderer.
 *
 * Model replies are markdown — `# headings`, `**bold**`, ``` fences — so
 * printing them as one `<p>` dumps the syntax at the reader. This renders the
 * forms models actually write in chat: headings, paragraphs (soft breaks
 * preserved), bullet/numbered lists, code fences, inline code, bold, italic,
 * strikethrough, links, quotes, rules and pipe tables.
 *
 * It builds React elements directly — never HTML strings, never
 * `dangerouslySetInnerHTML` — so a reply cannot inject markup, and links are
 * limited to http(s)/mailto.
 */

type Block =
  | { kind: "para"; text: string }
  | { kind: "head"; level: number; text: string }
  | { kind: "code"; lang: string; code: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" };

/**
 * Inline forms, tried in order: code wins over emphasis, emphasis over links.
 * Kept as a source string: each pass builds its own regex, because rendering
 * recurses (bold inside bold) and a shared /g/ object's `lastIndex` would be
 * reset underneath the caller — an infinite loop that hangs the transcript.
 */
const INLINE_SOURCE =
  "(`[^`\\n]+`)|(\\*\\*\\*[^*\\n]+\\*\\*\\*)|(\\*\\*[^*\\n]+\\*\\*)|(\\*[^*\\n]+\\*)|(~~[^~\\n]+~~)|(\\[[^\\]\\n]+\\]\\([^)\\s]+\\))|(https?:\\/\\/[^\\s<>[\\]]+)";

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HEADING = /^(#{1,6})(?:\s+(.*))?$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const BULLET = /^\s*[-*+]\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const LIST_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

function isBlockStart(line: string): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  );
}

/** `| a | b |` -> ["a", "b"]; forgiving about the outer pipes and spacing. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTable(lines: string[], index: number): boolean {
  const header = lines[index];
  const separator = lines[index + 1];
  if (!separator || !header.includes("|") || !separator.includes("|")) return false;
  if (!TABLE_SEP.test(separator)) return false;
  return cells(header).length === cells(separator).length;
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0].repeat(3);
      const lang = fence[2] ?? "";
      const body: string[] = [];
      index += 1;
      // An unterminated fence is normal mid-stream: the rest is still code.
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1; // consume the closing fence
      blocks.push({ kind: "code", lang, code: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "head",
        level: Math.min(heading[1].length, 6),
        text: (heading[2] ?? "").trim(),
      });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (isTable(lines, index)) {
      const head = cells(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        rows.push(cells(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        body.push(lines[index].replace(QUOTE, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line) && !BULLET.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = LIST_LINE.exec(current);
        if (match) {
          items.push(match[2]);
          index += 1;
        } else if (items.length > 0 && current.trim() !== "" && /^\s{2,}\S/.test(current)) {
          items[items.length - 1] += `\n${current.trim()}`; // wrapped item text
          index += 1;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Paragraph: run until a blank line or the start of another block.
    const body: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      (body.length === 0 || !isBlockStart(lines[index]))
    ) {
      body.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "para", text: body.join("\n") });
  }

  return blocks;
}

function link(label: string, href: string, key: number): ReactNode {
  if (!/^(https?:\/\/|mailto:)/i.test(href)) return <span key={key}>{label}</span>;
  return (
    <a key={key} href={href} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  );
}

/** Inline markdown inside one line of text (the block syntax is already gone). */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = new RegExp(INLINE_SOURCE, "g"); // fresh state per pass
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match[0] === "") {
      pattern.lastIndex += 1; // never stall on a zero-width match
      continue;
    }
    if (match.index > last) out.push(text.slice(last, match.index));
    const [raw, code, boldItalic, bold, italic, strike, ref, url] = match;
    if (code !== undefined) {
      out.push(<code key={key++}>{raw.slice(1, -1)}</code>);
    } else if (boldItalic !== undefined) {
      out.push(
        <strong key={key++}>
          <em>{renderInline(raw.slice(3, -3))}</em>
        </strong>,
      );
    } else if (bold !== undefined) {
      out.push(<strong key={key++}>{renderInline(raw.slice(2, -2))}</strong>);
    } else if (italic !== undefined) {
      out.push(<em key={key++}>{renderInline(raw.slice(1, -1))}</em>);
    } else if (strike !== undefined) {
      out.push(<del key={key++}>{renderInline(raw.slice(2, -2))}</del>);
    } else if (ref !== undefined) {
      const parts = LINK.exec(raw);
      out.push(parts ? link(parts[1], parts[2], key++) : <span key={key++}>{raw}</span>);
    } else if (url !== undefined) {
      // Trailing sentence punctuation belongs to the sentence, not the link.
      const trailing = /[.,;:!?"']+$/.exec(raw)?.[0] ?? "";
      const target = raw.slice(0, raw.length - trailing.length);
      out.push(link(target, target, key++));
      if (trailing) out.push(trailing);
    }
    last = match.index + raw.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A paragraph: inline markdown with the model's own line breaks kept. */
function renderText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  text.split("\n").forEach((line, index) => {
    if (index > 0) out.push(<br key={`br-${index}`} />);
    out.push(...renderInline(line));
  });
  return out;
}

/**
 * Blocks to elements. `tail` rides on the last block — the streaming caret
 * lands exactly where the next token will appear.
 */
function renderBlocks(blocks: Block[], tail?: ReactNode): ReactNode[] {
  return blocks.map((block, index) => {
    const rest = index === blocks.length - 1 ? tail : undefined;

    switch (block.kind) {
      case "para":
        return (
          <p key={index}>
            {renderText(block.text)}
            {rest}
          </p>
        );
      case "head": {
        const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return (
          <Tag key={index}>
            {renderText(block.text)}
            {rest}
          </Tag>
        );
      }
      case "code":
        return (
          <pre key={index}>
            <code className={block.lang ? `language-${block.lang}` : undefined}>
              {block.code}
            </code>
            {rest}
          </pre>
        );
      case "quote": {
        const nested = parseBlocks(block.text);
        return (
          <blockquote key={index}>
            {nested.length > 0 ? (
              renderBlocks(nested, rest)
            ) : (
              <p>
                {rest ?? null}
              </p>
            )}
          </blockquote>
        );
      }
      case "list": {
        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag key={index}>
            {block.items.map((item, itemIndex) => {
              const isLast = itemIndex === block.items.length - 1;
              return (
                <li key={itemIndex}>
                  {renderText(item)}
                  {isLast ? rest : undefined}
                </li>
              );
            })}
          </ListTag>
        );
      }
      case "table":
        return (
          <Fragment key={index}>
            <table>
              <thead>
                <tr>
                  {block.head.map((cell, cellIndex) => (
                    <th key={cellIndex}>{renderText(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{renderText(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rest}
          </Fragment>
        );
      case "rule":
      default:
        return (
          <Fragment key={index}>
            <hr />
            {rest}
          </Fragment>
        );
    }
  });
}

export default function Markdown({
  text,
  tail,
  className,
}: {
  text: string;
  /** Rides on the last block — the streaming caret. */
  tail?: ReactNode;
  className?: string;
}) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={className ? `cg-md ${className}` : "cg-md"}>{renderBlocks(blocks, tail)}</div>
  );
}
