# ContextGit `0.1.0-beta.1`

This is an unsigned beta for Windows x64, macOS Intel/Apple Silicon,
and Linux x64/arm64. Linux x86_64 means both AMD64 and Intel 64-bit CPUs.
Linux users can choose the format that matches their distribution: AppImage or
`.tar.gz` for any distro, `.deb` for Debian/Ubuntu, `.rpm` for Fedora/RHEL/SUSE,
or `.pacman` for Arch/Omarchy/Manjaro. Download the installer for your CPU
architecture and the matching `SHA256SUMS` file from the GitHub prerelease page.

For Omarchy and other Arch-based systems, use the **Linux x86_64 `.pacman`**
package, or the x86_64 AppImage. Do not use an arm64/aarch64 package unless
your machine reports `aarch64` or `arm64`.

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
