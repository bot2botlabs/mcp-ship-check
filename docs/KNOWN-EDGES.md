## Found by Codex (core)

- Version precedence assumes valid semver strings; malformed package versions are not validated.
- MCPB URL version detection recognizes standalone version path segments, not versions embedded in filenames.
- Windows shell quoting and descendant process cleanup are best effort; CI exercises Linux.
- Glama checks listing availability only because listing metadata does not provide a uniform package version field.
- Stdio transport expects newline-delimited JSON and does not support Content-Length framing.
