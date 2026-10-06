# Chat "Document" mode (the Docs tab)

Ask the assistant to write a document on any topic and download it as one of four
formats — **Markdown**, **PDF**, **Word** (`.docx`) or **PowerPoint** (`.pptx`) —
in a professional house style.

The Chat tab has two surfaces, switched by a segmented control in its toolbar:
**Chat** (the composer with Chat / Council / Research / Image) and **Docs** — a
dedicated document-creator workspace. Docs has a form (topic + format + **style**)
and a **library** of every document generated in the repository, each with a
**Download**.

## Flow

```
DocsCreator (the Chat → Docs surface)
  → POST /api/v1/documents/stream   (SSE: prompt, format, template)
      step    generating → rendering → (saving)
      token   the model's markdown, streamed
      document {id, filename, format, size, title, markdown}
      done    {commit_id, branch, staged}
      error   {error}                     # e.g. a missing renderer library
  → refresh library: GET /api/v1/documents        (newest first)
  → Download
      fetch GET /api/v1/documents/{id}?format=…
      → native Save dialog writes the file
```

The turn is **committed (or staged) to the conversation** exactly like a chat
turn. The rendered file is cached under `<repo>/.contextgit/documents/<id>.<ext>`
(with an `<id>.json` sidecar) so it can be re-downloaded; the user's own copy goes
wherever the Save dialog points.

## Styles

Three house styles, chosen next to the format — one definition
(`contextgit/documents/styles.py`) drives every renderer, so a "Report" looks like
a report in all four formats:

| Style | Look |
|---|---|
| **Report** | formal serif body, numbered sections, navy accent |
| **Brief** | concise sans-serif, one-page brief |
| **Proposal** | serif with an orange accent, framed as a proposal |

The chosen style also tunes the authoring prompt (a brief asks for ~300–500 words,
a report for ~800–1500).

## Content quality

Two things make the output usable:

- **The prompt** (`generate.py`) asks for a title, a one-line subtitle, `##`/`###`
  sections, real `-`/`1.` lists (never `#` as a bullet), fenced code blocks on their
  own lines, tables, an executive summary and a conclusion.
- **The parser** (`markdown.py`) is forgiving of the model's habits: it normalizes
  `###` used as a bullet marker, pulls inline ```bash code ``` fences onto their
  own lines, and understands numbered lists, tables, blockquotes and rules. It
  produces typed blocks (`heading`/`paragraph`/`bullets`/`ordered`/`code`/`table`/
  `quote`/`rule`).

## Engines and dependencies

Rendering is backend-side (`contextgit/documents/`):

| Module | What |
|---|---|
| `markdown.py` | forgiving markdown → typed blocks |
| `generate.py` | the authoring prompt and `build_document` |
| `styles.py` | the three house styles |
| `html.py` | blocks → HTML + CSS (cover, TOC, running header/footer) |
| `pdf.py` | **WeasyPrint** (HTML/CSS → PDF) with a **reportlab fallback** |
| `docx_writer.py` | Word: cover, TOC field, header/footer page numbers, styles |
| `pptx_writer.py` | a designed 16:9 deck (accent bar, bullet styling, slide numbers) |

- **PDF**: [WeasyPrint](https://weasyprint.org) gives the cover page, table of
  contents with real page numbers (`target-counter`), and a running
  header/footer (`counter(page) / counter(pages)`). It needs the **Pango/cairo**
  system libraries (`pacman -S pango cairo gdk-pixbuf2` on Arch). When it isn't
  available the PDF silently falls back to a **reportlab** template (cover +
  header/footer, no TOC) — a valid PDF every time.
- **Word** page numbers and the TOC are Word *fields*: Word offers to update them
  on open; LibreOffice fills them automatically.
- **PowerPoint** slides are drawn on a designed blank layout (accent bar, title,
  rule, bullets, slide number) so the deck looks intentional without a binary
  template.
- Optional extra: `pip install 'contextgit[export]'` (python-docx, python-pptx,
  reportlab, weasyprint). Missing libraries degrade to a clear message.
- The packaged backend bundles them (`desktop/scripts/build-backend.sh` collects
  `docx`/`pptx`/`reportlab`/`weasyprint` when installed).

## Tests

`tests/test_documents.py` and `tests/test_documents_style.py`: the parser over the
model's artefacts, every format × template rendering (magic bytes), the WeasyPrint
path with a page-count check (`pypdf`) and the reportlab fallback, and the API
route carrying a `template`.
