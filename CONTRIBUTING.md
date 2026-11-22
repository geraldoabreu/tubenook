# Contributing to TubeNook

Thank you for your interest in contributing to **TubeNook**! Whether you're fixing a bug, improving translations (`pt-BR`, `pt-PT`, `en`, `es`), or proposing a new feature, your help is welcome.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/tubenook.git
   cd tubenook
   ```
3. **Create a feature or fix branch**:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development & Testing

TubeNook runs on Node.js 22+ with no heavy build toolchain.

1. Run the test suite before and after making changes:
   ```bash
   npm test
   ```
2. Verify the extension builds cleanly into `dist/`:
   ```bash
   npm run build
   ```
3. Load `dist/` as an unpacked extension in `chrome://extensions/` to manually test your changes on YouTube.

### Translation Guidelines

If you add or modify any UI string, please update all 4 supported locales (`pt-BR`, `pt-PT`, `en`, `es`) to keep full i18n parity. The test suite verifies that every translation key exists across all four locales.

## Submitting a Pull Request

1. Keep your pull request focused on a single feature or fix.
2. Make sure `npm test` and `npm run build` pass without errors.
3. Write a clear PR description explaining what changed and why.
4. Open a Pull Request targeting the `main` branch.

## Suggesting Features & Reporting Issues

- Open a GitHub Issue with reproduction steps (for bugs) or a clear use case (for features).
- Or email your suggestions and feedback directly to **[dev@aevren.si](mailto:dev@aevren.si)**.
