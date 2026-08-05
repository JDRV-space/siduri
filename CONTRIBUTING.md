# Contributing

This is a small self-hosted app, not a broad platform project. Keep changes narrow and practical.

## Local Setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:8080`.

You need a GCS bucket and Google application-default credentials for real uploads.

## Change Rules

- Do not add framework, build, or database rewrites unless the change needs them.
- Keep the vanilla frontend and Express backend simple.
- Preserve the single-instance SQLite assumption unless you are replacing the storage model.
- Update `README.md` when behavior, deployment, config, or limits change.
- Keep secrets out of examples, logs, screenshots, and commits.

## Style

- JavaScript, no TypeScript.
- 2-space indentation.
- Single quotes and semicolons.
- Descriptive names over clever abstractions.

## Checks

Before sending a change, run the checks that cover its owners. The full repository checks are:

```bash
npm ci
npm run security:audit
npm test
python3 -m unittest discover -s functions/gif-generator -p test_main.py
python3 -m unittest discover -s functions/video-subtitles -p test_main.py
pip-audit --no-deps --disable-pip -r functions/gif-generator/requirements.txt
pip-audit --no-deps --disable-pip -r functions/video-subtitles/requirements.txt
docker build -t siduri:ci .
```

Then manually exercise any changed user workflow. For docs-only changes, at least run:

```bash
git diff --check
```

## Security

Follow [SECURITY.md](SECURITY.md). Do not put secrets or exploit details in a public issue.
