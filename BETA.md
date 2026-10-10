# ContextGit `0.1.0-beta.1`

This is an unsigned friends beta for Windows x64, macOS Intel/Apple Silicon,
and Linux x64/arm64. Linux users can choose either a portable AppImage or a
Debian/Ubuntu `.deb` package. Download the installer and matching `SHA256SUMS`
file from the GitHub prerelease page.

The beta focuses on terminal agents and Git context. It does not bundle an
editor and does not expose the Why analysis surface.

## Support contract

- Any installed shell or terminal agent can be launched in a ContextGit run.
- Usage reporting is available only for agents with a working local parser.
- Native transcript capture is verified per agent. OpenCode is the first fully
  verified integration; other agents may work as terminals without capture.
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
