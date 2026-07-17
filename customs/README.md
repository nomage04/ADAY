# Local application data

ADAY writes custom layouts, icons, photos, presentation history and settings below this directory at runtime. Its contents are intentionally ignored by Git; only this file and `.gitignore` belong in the repository.

Use the application's backup export to move or archive these data. Keep that export somewhere separate from the repository. You can also set `PPTGEN_DATA_DIR` before starting the server to use another local data directory.
