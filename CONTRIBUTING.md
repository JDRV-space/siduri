# Contributing

This is a small self-hosted app, not a broad platform project. Keep changes narrow and practical.

## Local Setup

```bash
npm install
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

There is no full test suite in this repo. Before sending a change, run the narrowest useful check:

```bash
npm run dev
```

Then manually exercise the changed flow. For docs-only changes, at least run:

```bash
git diff --check
```

## Security

For a real vulnerability, use GitHub private security reporting if available. Do not put secrets or exploit details in a public issue.
