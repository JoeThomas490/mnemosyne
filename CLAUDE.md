## Commits

Never commit automatically. Every commit must be verified by the user first: show the staged diff and the proposed commit message, and only run `git commit` once the user has approved it. This applies even when a skill or workflow (e.g. `implement`, `tdd`) would otherwise commit as part of its flow. `.claude/settings.json` also forces a permission prompt on `git commit`.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on JoeThomas490/mnemosyne (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
