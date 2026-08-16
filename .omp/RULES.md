# Sticky safety rules

- Never read, mutate, migrate, import into, or smoke-test against the operational SQLite database under `data/`; use a temporary database path.
- Never use real YNAB credentials, tokens, plans, or remote writes in development, tests, or browser automation; use the existing fake YNAB server and test-only credentials.
- Never print, commit, or place secrets, `.env` contents, SQLite files, CSV exports, or handoff artifacts in tracked output.
- Never commit, push, merge, deploy, or change CI permissions unless the user explicitly requests that exact action.
- Do not suppress a failing check; fix the root cause or report the exact blocker.
