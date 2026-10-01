# Engineering Quality

Prioritize correctness, clarity, and maintainability over speed or volume of code.
Apply the same review standard regardless of whether code is human- or AI-authored;
generated code must be understandable, justified, tested, and maintainable.

## Documentation Before Implementation

- Do not implement a new feature or extend user-visible behavior unless an existing
  feature guide in `docs/` documents the intended behavior, contracts, limitations,
  and acceptance criteria. Identify the relevant guide before writing feature code.
- If documentation is missing, incomplete, or ambiguous for the requested feature,
  pause implementation and prompt the user to supply or clarify it, or authorize
  documentation-first work. Do not silently invent requirements or treat a
  placeholder as sufficient documentation. Document the agreed behavior before
  implementing it, then follow the test-driven workflow below.
- Once the agreed behavior is documented and conflicts are resolved, implementation
  may proceed without a separate documentation approval checkpoint.
- If existing documentation or a request to write or change documentation conflicts
  with these engineering quality rules, explain the concrete conflict, suggest
  quality-preserving alternatives, and ask the user to resolve it before proceeding
  with the affected documentation or implementation. Do not silently weaken the
  quality rules or encode conflicting requirements as an approved specification.

## Test-Driven Changes

- For testable behavior changes and bug fixes, follow red-green-refactor: add a
  focused failing test, run it to confirm the intended failure, implement the
  smallest correct change, then refactor with tests passing.
- A failing test must expose the missing behavior or regression, not merely a
  syntax error or broken test setup. Test observable contracts and meaningful
  failure cases rather than private implementation details.
- Test-first is not mandatory for documentation-only changes, mechanical changes
  with existing coverage, or behavior that cannot reasonably be reproduced in the
  available environment. State the reason and use the closest practical check;
  add regression coverage where feasible and disclose remaining verification gaps.
- Reuse the existing test runner and helpers. Keep tests deterministic and isolated:
  inject process/host boundaries, use temporary filesystem fixtures, and avoid
  real package installations or network access in unit tests. Use separate,
  explicitly identified integration checks for real external systems.

## Code Organization and Readability

- Follow the established TypeScript/Node.js conventions and
  [architecture](../docs/architecture.md). Keep CLI and GitHub Action adapters
  thin; shared behavior belongs in the core, not duplicated across entry points.
- Group code by cohesive responsibility. Separate policy, tool discovery, process
  execution, and presentation when doing so reduces complexity or improves testing;
  avoid both catch-all modules and needless one-function files.
- Write self-documenting code: descriptive domain names, explicit contracts, small
  focused functions, and straightforward control flow. Use comments for rationale,
  constraints, or non-obvious tradeoffs, not to narrate what the code already says.
- Prefer established APIs and suitable existing utilities. Introduce dependencies
  or abstractions only when they solve a concrete problem; avoid speculative
  frameworks, unnecessary indirection, and unrelated cleanup.
- Validate data at external boundaries, handle errors deliberately, and preserve
  useful diagnostics. Do not mask failed operations or claim success based only
  on superficial checks.
- Consider Windows, macOS, and Linux explicitly. Isolate platform-specific behavior,
  use path/process APIs safely, and test supported alternatives rather than
  hard-coding the current developer's environment.

## Documentation and Verification

- Feature guides in `docs/` are both specifications and user documentation.
  Update commands, contracts, limitations, and acceptance criteria in the same
  change as behavior; do not create a duplicate internal specification tree.
  Use the [prerequisite guide](../docs/prerequisites.md) as the current example.
- Before finishing code changes, run focused checks followed by `npm run check`.
  Include regenerated tracked bundles in `dist/`; never hand-edit generated code.
  For documentation-only work, validate relevant links and examples instead.
- Review the change for correctness, security, readability, unnecessary complexity,
  and missing tests. Fix issues introduced by the change without expanding into
  unrelated refactoring. Report what was verified and what remains unverified;
  mocked platform tests are not proof of execution on those platforms.