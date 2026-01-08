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

```bash
git clone https://github.com/kwesolowski/node-red-contrib-philips-airplus.git
cd node-red-contrib-philips-airplus
npm install
npm test
```

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
