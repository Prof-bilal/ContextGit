# ContextGit `0.2.0-beta.6`

This revision adds model context-window meters and a project learning loop:
conversation checkpoints, editable lesson drafts, and a per-project AI connection.

This beta ships a lightweight browser workbench. Install the Python package,
then run `contextgit web`; the local API and browser UI start together without
a bundled native runtime.

Each agent tab now shows the model context window and an estimated token usage
meter, resolved from a built-in model catalog. Closing an agent saves a
checkpoint for review: rate it, tag the reason, and export redacted Markdown
under `.contextgit/knowledge/conversations/`. Generate a learning draft from the
selected provider, then approve or reject it; approved lessons are written as
`SKILL.md` files under `.contextgit/knowledge/skills/` and indexed in the managed
`AGENTS.md` block. Drafts and ratings alone never activate guidance. Structured
capture is currently verified for OpenCode; other agents use a bounded terminal
recording labeled partial.

This beta also includes the optional code-server workbench, reduced background
polling and idle cleanup, the command palette, square-corner UI, and a direct
project shell terminal.
The Why analysis surface is not exposed.

## Support contract

- Any installed shell or terminal agent can be launched in a ContextGit run.
- Usage reporting is available only for agents with a working local parser.
- Native transcript capture is verified per agent. OpenCode is the first fully
  verified integration; other agents may work as terminals without capture.
- AI cleaning and learning require a configured provider. Ollama works without an
  API key; a custom OpenAI-compatible endpoint is also supported.
- Learning is isolated per project. Markdown and skills live under the ignored
  `.contextgit/` folder and are local artifacts, not automatically committed.
- Use **Code → Diagnostics** when reporting a problem. Include the platform,
  architecture, shell, backend state, and agent detection results.

## First-run warnings

Installers are unsigned during this beta. Windows may show SmartScreen; choose
the option to view more information and continue only if the checksum matches.
macOS may block the first launch in Gatekeeper; use **Open** from the context
menu after verifying the checksum.

## Reporting a bug

Include the beta version, operating system and architecture, agent name/version,
exact reproduction steps, and the diagnostics output. Do not attach API keys,
private conversation transcripts, or unredacted environment files.
