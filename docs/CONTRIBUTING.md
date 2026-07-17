# Contributing

Thank you for helping improve ADAY.

## Before opening a change

Search existing issues and pull requests first. For a substantial feature or a public-interface change, open an issue so the behavior and scope can be discussed before implementation. Security reports must follow [SECURITY.md](SECURITY.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development workflow

1. Fork the repository and create a focused branch from `dev`.
2. Install Python and Node dependencies as described in the README.
3. Keep runtime data out of Git. Use a separate `PPTGEN_DATA_DIR` for test material.
4. Add or update tests for every behavior change.
5. Run `npm run check` and confirm `git status --short` shows only intentional source changes.
6. Open a pull request with a clear problem statement, implementation summary and validation notes.

Avoid unrelated formatting or broad refactors in focused fixes. Generated files must be updated with their canonical build commands, never edited by hand.

## Commit and pull-request guidance

Use short, imperative commit subjects. Keep commits reviewable and do not include API keys, user data, generated decks, screenshots or personal paths. Link relevant issues with `Fixes #123` when appropriate.

Pull requests should target `dev` unless a maintainer requests another base. Maintainers promote validated release snapshots from `dev` to `main`.

## Tests

The required quality gate is:

```text
npm run check
```

It covers deterministic generated artifacts, repository hygiene, unit and server tests, browser flows, all renderers, preview output and the SmartArt parser path. CI runs the same command on Windows and Linux.
