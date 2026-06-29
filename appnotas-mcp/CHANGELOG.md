# Changelog

All notable changes to this service are documented here.

## [0.1.0]
- Initial release — local read/write access to AppNotas Markdown notes + tasks.
- Tools: `list_notes`, `search_notes`, `read_note`, `create_note`,
  `update_note`, `delete_note` (soft), `list_tasks`, `toggle_task`.
- File-based `NotesStore` over the AppNotas notes folder (auto-discovered from
  the AppNotas settings file, or `NOTES_DIR`). Parses/serializes the app's
  frontmatter format (title/created/modified/tags/color + body).
- Guardrails: path confinement (`*.md`, optional `tasks/`, no traversal),
  non-destructive UPDATE that preserves `created`/`tags`/`color` (the app's own
  save is lossy), soft DELETE to `.trash` requiring `confirm=true`, atomic
  writes with retry (OneDrive lock tolerance), and BOM-tolerant parsing.
- Scaffolded by mcp-factory; inherits the template hardening (auth, limits,
  reverse-proxy, CI, Docker, stdio + HTTP).
- Note: the AppNotas desktop app caches notes with no file watcher — after a
  write, the user may need to reload the app to see changes.
