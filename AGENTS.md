# unofficial-trackjs-mcp

A public, read-only MCP server for the TrackJS Data API, published to npm. `README.md` is the reference for tools and setup.

- **Read-only stays read-only.** Only `GET` endpoints of the Data API.
- **No live calls in tests.** Tests run against mocked responses and need no API key.
- `npm run check` must pass before pushing. CI runs the same.
- **Releasing is the owner's.** Work on a branch and open a pull request; the owner merges. No `npm publish`, no version bump or tag, and no runs against a live TrackJS key unless the owner asks in the session.
