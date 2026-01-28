# Contributing to Siduri

Thanks for your interest in contributing to Siduri!

## Development Setup

1. Fork and clone the repository
2. Copy `.env.example` to `.env` and configure your environment
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Open http://localhost:8080

## Code Style

- ES6+ JavaScript (no TypeScript)
- 2-space indentation
- Single quotes for strings
- Semicolons required (match existing style)
- Descriptive variable names

## Project Structure

```
siduri/
├── server/          # Express backend
│   ├── routes/      # API endpoints
│   ├── lib/         # Utilities (db, gcs, auth)
│   └── middleware/  # Express middleware
├── public/          # Frontend (vanilla JS)
│   ├── js/          # Page scripts
│   └── css/         # Styles
└── functions/       # Google Cloud Functions
```

## Pull Request Process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Test locally to ensure nothing breaks
4. Update README.md if you're adding features
5. Commit with a clear message:
   ```bash
   git commit -m "Add feature: description"
   ```
6. Push and open a Pull Request

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include steps to reproduce for bugs
- Check existing issues before creating new ones

## Security Issues

For security vulnerabilities, please open a private security advisory on GitHub instead of a public issue.

## Questions?

Open a GitHub Discussion or issue if you have questions about contributing.
