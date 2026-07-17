# Development

## Environment

```powershell
python -m pip install -r requirements.txt
npm ci
npx playwright install chromium
python -m backend.server
```

Keep the server bound to `127.0.0.1`. Set `PPTGEN_DATA_DIR` for experiments that must not write to the project-level `customs/` directory.

## Repository rules

- `packs/default/` is the source of bundled assets. Regenerate and commit `web/asset_pack.generated.js` after changing it.
- `config/repository_constraints.json` is the source of shared limits. Regenerate and commit `web/core/constraints.generated.js` after changing it.
- Persistent user data must go through `PPTGen.repoStore` and `/api`; do not add new `localStorage` persistence.
- Runtime data below `customs/` stays ignored. Add only its `.gitignore` and README to Git.
- API keys stay in the browser tab by default. The opt-in `config/config.local.js` file contains plain text and must remain ignored.
- New data collections require client and server validation, explicit size limits and atomic-write tests.
- The public server surface must remain loopback-only.

## Commands

```powershell
npm run build:assets
npm run build:constraints
npm run test:unit
npm run test:server
npm run test:e2e
npm run test:renderers
npm run test:preview
npm run test:smartart
npm run check
```

The validation suite includes `npm run check:secrets`, which checks the current repository and all reachable Git revisions without printing detected credential values.

`npm run check` also rejects personal paths, runtime data, obsolete artifacts and removed integration files in the Git snapshot.

## Pull requests

Create a focused branch, add tests with behavior changes, run `npm run check`, and confirm that a second validation run does not modify generated files. Pull requests target `main`; ongoing integration work may land on `dev` before a release.
