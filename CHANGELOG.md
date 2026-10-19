# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-19

### Added

- First release. An unofficial MCP server for the TrackJS Data API over stdio.
- Read-only tools: `list_errors`, `top_messages`, `errors_by_url`, `errors_by_day`, `errors_by_hour`, `page_views_by_day`, `page_views_by_hour`, `usage_by_hour`.
- Compact output with truncation, stack trimming (`maxStackLines`), paging info (`nextPage`), totals, and TrackJS dashboard links.
- Clear startup error when `TRACKJS_API_KEY` or `TRACKJS_CUSTOMER_ID` is missing. Tool errors that explain 400/401/403/404/429/5xx, timeouts, and network failures.
- `server.json` for the official MCP registry.

[Unreleased]: https://github.com/olaj/unofficial-trackjs-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/olaj/unofficial-trackjs-mcp/releases/tag/v0.1.0
