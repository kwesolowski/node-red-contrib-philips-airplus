# Contributing

## Project Context

This package was developed for personal use and primarily implemented with AI assistance (Claude Code). Support is provided on a **best-effort basis with no guarantees**.

## Reporting Issues

Bug reports are welcome. Please include:

- **Device model** (e.g., AC3737)
- **Node-RED version**
- **Node.js version**
- **Error logs** from Node-RED debug panel
- **Steps to reproduce** the issue

## Development Setup

### Prerequisites

- Node.js >= 14
- npm
- pre-commit (install via `pip install pre-commit` or `brew install pre-commit`)

### Setup

```bash
git clone https://github.com/kwesolowski/node-red-contrib-philips-airplus.git
cd node-red-contrib-philips-airplus
npm install
pre-commit install
```

### Code Quality

```bash
npm run lint          # Check code style
npm run lint:fix      # Auto-fix linting issues
npm run format        # Format code with Prettier
npm run format:check  # Check formatting
npm test              # Run Jest tests
```

Pre-commit hooks run automatically before each commit (ESLint, Prettier, Jest).

### Making Changes

1. Make changes
2. Commit - hooks auto-fix style issues
3. If tests fail, fix and retry

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage
```

## Pull Requests

PRs are accepted but may take time to review. When submitting:

1. Create a feature branch from `main`
2. Add tests for new features when applicable
3. Ensure all tests pass (`npm test`)
4. Provide clear description of changes
5. Update README if adding user-facing features

## Code Style

- Follow existing code patterns
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions focused and small

## Questions

For questions about usage or protocol details, check:

- `README.md` for usage examples
- `docs/` directory for protocol documentation
- `examples/` for complete flows
