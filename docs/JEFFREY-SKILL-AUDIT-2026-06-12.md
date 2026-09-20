# Jeffrey Skill Audit: Chrome MCP Bridge

Status: completed.

This document records the sequential Jeffrey skill pass requested on 2026-06-12. Each section is completed before the next skill begins.

## 1. Deep Project Primer

Skill: `/jef_deep_project_primer`

Plan:

- Read the project instructions supplied in the session and the checked-in README.
- Verify current git state before analysis.
- Inspect architecture docs, package scripts, public entrypoints, core runtime modules, and verification surface.
- Summarize project purpose, domains, data flow, dependencies, key risks, and current testing posture.

Execution notes:

- No checked-in `AGENTS.md` exists in or above the repository at the time of this pass, so the session-provided AGENTS instructions were treated as the active project guidance.
- The repository was clean and synchronized with `origin/main` before starting.

Project purpose:

Chrome MCP Bridge is a local-first bridge between AI agents and the user's real logged-in Chrome profile. It combines a Chrome Manifest V3 extension, a local loopback Native Messaging Host, a CLI, and a stdio MCP server. The product intentionally optimizes for read-mostly, scoped, human-owned browser workflows rather than cloud browser farms, stealth scraping, CAPTCHA bypass, or unattended account mutation.

Primary runtime surfaces:

- `extension/`: the only layer that talks directly to Chrome extension APIs, page scripts, debugger/CDP, browser data, downloads, screenshots, PDF export, prompts, tab groups, and workspace policy.
- `native/host.mjs`: local Native Messaging Unix Socket command broker on loopback. It validates direct command ingress, payload envelopes, timeout bounds, extension origin/id parity, stale extension versions, and bridge shutdown lifecycle.
- `bin/chrome-bridge.mjs`: stable CLI binary wrapper. Runtime implementation currently lives in `bin/cli/main.mjs`.
- `mcp/chrome-bridge-mcp.mjs`: stable MCP binary wrapper. Runtime implementation currently lives in `mcp/server/main.mjs`.
- `shared/registry/`: source of truth for extension actions, CLI commands, MCP tools, command metadata, docs generation metadata, risk tiers, default timeouts, and payload validation.

Key data flow:

```text
CLI or MCP client
  -> local loopback Native Messaging Host
  -> Chrome extension Native Messaging/offscreen document
  -> Chrome extension APIs, injected page helpers, or Chrome Debugger/CDP
  -> result returns through the same path
```

Safety model:

- The protected asset is the user's real Chrome profile.
- Default browser work is scoped to a managed `Codex Bridge` tab group or a session-derived `Codex Bridge - <session>` group.
- Mutations require `confirmed=true` / `--confirm`.
- Private values such as cookie values, storage values, whole cookie jars, and credentialed requests require sensitive confirmation.
- The bridge binds to loopback by default and refuses non-loopback host binding without an explicit unsafe environment flag.
- Direct browser-origin command ingress is rejected; extension ingress requires `chrome-extension://` origin handling and origin/id parity where reported.

Dependencies:

- Runtime: Node.js ESM, `ws`, `zod`, `@modelcontextprotocol/sdk`.
- Chrome: Manifest V3 extension APIs, offscreen document, `chrome.scripting`, debugger/CDP where needed.
- Distribution: npm package files include CLI, MCP server, extension, docs, examples, scripts, server, and shared modules.

Verification posture:

- CI runs `npm run check`, `npm run check:audit`, and `npm run check:pack` on Node 20, 22, and 24.
- CodeQL runs for JavaScript/TypeScript on push, PR, and weekly schedule.
- `npm run check` is a broad static and fixture-backed suite covering syntax, registry/docs parity, CLI/MCP local behavior, bridge contract, extension module contracts, roadmap coverage, examples, privacy scanning, package contents, and offline smoke-plan behavior.
- Live browser verification uses `reload-extension --confirm`, `doctor --live-checks`, and `runtime-smoke --summary-only --out <file>`.

Important current strengths:

- The project has strong command-surface parity: CLI, MCP, docs, registry, package contents, and extension dispatch are checked together.
- The safety model is explicit and repeatedly verified.
- Runtime-smoke supports an offline plan and a bounded live verification path, which is useful when another session is using the bridge.
- Recent reorganization preserved public entrypoints while splitting registry, CLI, MCP, and page scripts behind stable wrappers.

Important current risks to investigate in later skills:

- `bin/cli/main.mjs` is still very large at about 4,195 lines, even after becoming an implementation module behind a stable wrapper.
- `mcp/server/main.mjs` is still large at about 2,176 lines and registers many tools directly in one module.
- `extension/page-scripts/main.js` remains a large injected-helper module at about 1,442 lines; it is structurally isolated but not semantically split.
- Some verification scripts are themselves large and string-search-heavy, especially `check-command-registry.mjs` and `check-cli-local-tools.mjs`.
- The repository has excellent static and smoke checks, but future work should continue separating tests that prove behavior from checks that merely assert source strings.

Primer result:

The project is mature for a local developer tool: safety, packaging, docs, and parity checks are unusually strong. The main next opportunity is not adding random features; it is reducing maintenance concentration in the large CLI/MCP/page-script/checker modules while preserving the registry-first contract and the local-first safety boundary.

## 2. System Weaknesses Analyzer

Skill: `/jef_system_weaknesses`

Plan:

- Use the primer context to identify the weakest system areas.
- Verify the critique with local evidence instead of vibes.
- Separate intentional product boundaries from actual weaknesses.
- Record prioritized weak spots for later skills to convert into fixes.

Evidence gathered:

- Largest JavaScript modules by line count:
  - `bin/cli/main.mjs`: about 4,196 lines.
  - `mcp/server/main.mjs`: about 2,177 lines.
  - `extension/page-scripts/main.js`: about 1,443 lines.
  - `scripts/checks/contracts/check-command-registry.mjs`: about 1,396 lines.
  - `scripts/checks/cli/check-cli-local-tools.mjs`: about 1,140 lines.
  - `scripts/checks/mcp/check-mcp-local-tools.mjs`: about 787 lines.
  - `native/host.mjs`: about 745 lines.
- Source-pattern scan across runtime and scripts found heavy string-search coupling:
  - `includes(` appears more than 1,500 times.
  - `JSON.parse` appears more than 100 times.
  - `server.tool(` appears about 75 times in the MCP server module.
- Dependency scan found `zod` on `3.25.76` while latest npm is `4.4.3`.
- Existing docs intentionally mark Streamable HTTP and cloud/scale as not implemented; those are product-boundary decisions rather than accidental omissions.

Weakest areas:

1. CLI implementation concentration.

   `bin/cli/main.mjs` is still the largest and most change-prone file. It owns argument parsing, bridge fetches, output formatting, self-test, runtime smoke, local config writers, action preview/apply glue, and many command handlers. Even with the stable wrapper split, future contributors still need to reason across thousands of lines for routine CLI work.

2. MCP implementation concentration.

   `mcp/server/main.mjs` registers most tools in one long module and mixes schema definitions, local helper behavior, bridge forwarding, prompts, resources, profiles, and transport startup. The registry keeps parity safe, but human review of MCP behavior remains harder than it needs to be.

3. Injected page helper concentration.

   `extension/page-scripts/main.js` is isolated behind a wrapper, but it still combines text collection, HTML extraction, diagnostics, selectors, element refs, interactions, storage snapshots, observation, extraction, and snapshots. Because these functions execute inside page context, careless splitting can break closures. Still, the current single large file makes subtle DOM behavior hard to audit.

4. Checker suite brittleness.

   The verification suite is strong but many checks assert source strings and path contents directly. This is useful for guardrails, but over time it can make refactors feel like pleasing a regex court rather than proving behavior. The worst concentration is `check-command-registry.mjs`, followed by CLI/MCP local tool checks.

5. Dependency modernization risk.

   `zod` v3 is stable and currently works with the MCP SDK usage, but v4 exists. The weakness is not "upgrade immediately"; it is that there is no documented compatibility decision or compatibility check explaining why v3 remains pinned.

6. Live-environment verification is strong but manual.

   Runtime smoke is excellent, but the release confidence loop still depends on remembering when to run live reload/doctor/smoke. The CLI reports recovery hints well; the remaining weakness is workflow ergonomics around "am I safe to run live smoke now?" and recording the result in release docs.

7. Product boundaries are clear but can be misunderstood.

   The project intentionally does not implement hosted cloud browser sessions, proxy pools, CAPTCHA solving, large-scale crawling, or Streamable HTTP MCP transport. These are not bugs, but they are recurring comparison pressure points. Docs already explain them; future marketing and command guidance should keep steering users to the right tool instead of expanding the local bridge beyond its safety model.

Highest-value improvement themes for later skills:

- Continue shrinking CLI/MCP implementation modules into cohesive submodules without changing public binaries.
- Convert the most brittle source-string checks into helper-driven or behavior-driven checks where feasible.
- Add a documented `zod` v3/v4 compatibility note or a safe migration spike before changing it.
- Split `extension/page-scripts/main.js` only along page-context-safe boundaries, with tests that catch closure/import mistakes.
- Keep live smoke and token-budget hygiene first-class because this project is used by agents inside long sessions.

System weakness result:

The weakest part of the system is not missing browser power; it is maintenance concentration. Chrome MCP Bridge has a strong product strategy and unusually good safety verification, but the next wave should make the codebase easier to change safely by reducing giant modules and making behavioral checks less string-fragile.

## 3. Project Opinion Elicitor

Skill: `/jef_project_opinion_elicitor`

Plan:

- Give a candid opinion on whether the project is a good idea.
- Evaluate usefulness, design, architecture, pragmatism, and agent/human UX.
- Identify what feels strange, fragile, overbuilt, or unfinished.
- Convert the opinion into practical direction for later implementation skills.

Opinion:

This is a good idea, and it is more useful than a generic browser automation wrapper because it targets a real gap: agents often need the user's already-authenticated browser context, not a pristine Playwright profile. The strongest product insight is that local real-profile access is valuable only if it is boringly safe. The project understands that and keeps the core differentiator focused on scoped tab groups, explicit confirmations, local artifacts, and metadata-first outputs.

The architecture is basically right:

- The extension owns Chrome APIs.
- The Native Messaging Host owns loopback transport and ingress validation.
- CLI and MCP are clients over the same command surface.
- The shared registry keeps command metadata, docs, CLI, MCP, and validation from drifting.

That said, the implementation has an "ambitious solo tool that grew fast" smell in a few places. The checks are impressive, but sometimes the project compensates for large modules with increasingly elaborate source-string checks. That works, but it makes the system feel a little like a museum with laser tripwires: safe, yes; easy to rearrange, not always.

What is genuinely compelling:

- It solves logged-in-dashboard workflows that clean-profile browser automation does not solve well.
- It exposes both CLI and MCP, which is exactly right for agent ecosystems.
- It treats token budget as a product feature rather than an afterthought.
- It has better local safety posture than most browser-control tools.
- It has a real verification culture: static checks, pack checks, offline smoke plans, and live runtime smoke.

What feels overcomplicated:

- The CLI implementation is doing too much in one file, so every new feature feels like entering the engine room through a submarine hatch.
- The MCP server module is too declarative-dense: schemas, tool registration, resources, prompts, profile filtering, bridge calls, and local command wrappers are all close together.
- Some checks are effectively structural assertions about source text rather than tests of behavior. They are useful guardrails, but too many of them can make refactoring mentally expensive.
- Docs are rich but heavy. New humans may feel "this is serious and safe" before they feel "I can use this in five minutes."

What feels unfinished:

- The installed Codex skill and project docs should keep converging around cheap-first workflows and runtime-smoke recovery.
- The reorganization has reduced public entrypoint risk but has not yet made the CLI/MCP internals pleasant to modify.
- Dependency strategy is not fully documented, especially around staying on Zod v3 while v4 exists.
- Streamable HTTP is correctly deferred, but users comparing MCP servers may still interpret "stdio only" as less modern unless the compatibility story stays crisp.

Most useful next direction:

Do not chase cloud-browser competitors. The winning lane is "the safest local real Chrome MCP bridge for agents." Make it easier to install, easier for agents to choose the right tool, and easier for maintainers to change without fear. The next implementation work should therefore prioritize maintainability, onboarding clarity, and behavior-backed checks over large new browser powers.

Opinion result:

Chrome MCP Bridge is a strong project with a coherent niche. Its main risk is becoming intimidating: too many tools, too many docs, too much source concentration. The project becomes more compelling if it feels like a small, trustworthy local appliance from the outside and a set of clean, obvious modules from the inside.

## 4. Premortem Planner

Skill: `/jef_premortem_planner`

Plan:

- Imagine Chrome MCP Bridge failed six months from now.
- Identify what went wrong, which assumptions were false, which edge cases or integrations were missed, and what users hated.
- Revise the improvement plan to prevent the most plausible failure modes.

Six-month failure scenario:

Chrome MCP Bridge has many features and good intentions, but adoption stalls. Advanced users try it once, see a long README, broad extension permissions, a large MCP tool list, and a local setup sequence, then bounce. Maintainers hesitate to change internals because the CLI/MCP/checker modules are huge and the tests are partly source-string tripwires. Users who do install it sometimes forget to reload the extension after updates, run stale versions, or do not understand why a command refuses to touch a tab outside the scoped group. Competitors with simpler onboarding win mindshare even if they are less safe.

False assumptions:

- "Strong docs automatically mean good onboarding." Dense docs can communicate seriousness while still slowing first success.
- "Registry parity solves maintainability." It prevents drift, but it does not make giant command handlers pleasant to edit.
- "Agents will choose the cheap-first command." They often choose the most obvious command unless the skill/docs/tool descriptions steer them hard.
- "Runtime smoke is enough if it exists." It only protects releases when people actually run it at the right time and understand the recovery hints.
- "Local-first positioning is self-evident." Users compare against Playwright MCP, Chrome DevTools MCP, BrowserMCP, Browserbase, Browserless, and other tools; the project must quickly explain when it is the right choice and when it is not.

Missed edge cases:

- MCP clients with low tolerance for large tool lists or long tool descriptions.
- Chrome behavior changes around saved tab groups, offscreen documents, debugger permissions, or MV3 lifecycle.
- Pages with nested iframes/shadow DOM that produce confusing observe/extract gaps.
- Long-lived agent sessions accumulating local artifacts, stale smoke tabs, or stale group policy assumptions.
- Large command outputs that pass tests but burn agent context in real use.
- Contributors making "small" command changes that require updates across registry, CLI, MCP, docs, package contents, smoke plan, and checks.

What users would hate:

- "I installed it but do not know which command to run first."
- "The bridge opened or focused something while I was working."
- "The extension has broad permissions and I cannot tell what is safe."
- "The MCP tool list is huge and my agent picks weird tools."
- "A refactor broke a command even though static checks passed."
- "The docs explain everything except the exact path for my client."

Revised prevention plan:

1. Make first success smaller.

   Keep README rich, but ensure the top path stays extremely short: install, load extension, start server, generate MCP config, run doctor, run one safe read. Keep advanced docs one click away, not in the user's face.

2. Keep shrinking internal hot spots.

   Prioritize CLI and MCP internals before adding major new browser powers. Smaller modules reduce contributor fear and make code review more reliable.

3. Prefer behavior-backed checks for new work.

   Keep source-string checks where they guard package/public-entrypoint drift, but new feature work should favor fake bridge/server fixtures, registry-derived assertions, and runtime-smoke coverage where possible.

4. Make cheap-first agent usage unavoidable.

   Update skill/docs/prompts so agents naturally pick `status --token-budget`, `tabs --summary-only`, `observe`, `grep-page`, `page-search`, artifacts, and `runtime-smoke --summary-only` before expensive raw dumps.

5. Keep live smoke operationally obvious.

   Continue preserving `nextCommand`, `nextAction`, `finalCommands`, and `finalMcpCalls`. Consider a future `verify-release` wrapper that runs reload, live doctor, smoke summary, pack, audit, and status in one command when Chrome is free.

6. Treat client compatibility as a product surface.

   Keep Claude Code, Cursor, Codex, VS Code, Windsurf, Hermes, and generic stdio examples current. Compact tool profiles are not just optimization; they are adoption infrastructure.

7. Keep product boundaries explicit.

   Do not quietly drift into cloud crawling, stealth, proxy pools, CAPTCHA solving, or unattended account mutation. Instead, document when another tool is better.

Premortem result:

The most likely failure is not a single catastrophic bug. It is slow complexity creep: too many surfaces, too much setup, too much internal concentration, and too much cognitive load for agents and humans. The prevention plan is to keep making the safe path shorter and the internals less scary.

## 5. Idea Wizard

Skill: `/jef_idea_wizard`

Plan:

- Generate 30 improvement ideas.
- Evaluate them critically.
- Keep the best ideas that are high-leverage, low-regret, and aligned with the local-first safety model.
- Implement the top ideas immediately where they can be completed safely in this pass.

Thirty ideas:

1. Add a maintenance-quality doc and checker that tracks module-size hot spots and refactor priorities.
2. Add a dependency strategy note explaining why Zod v3 is currently retained and what would justify v4 migration.
3. Add a release verification wrapper command.
4. Split `bin/cli/main.mjs` into parser, bridge client, local commands, browser commands, smoke, docs/setup, and output modules.
5. Split `mcp/server/main.mjs` into schemas, bridge client, profiles, resources, prompts, and tool groups.
6. Split `extension/page-scripts/main.js` into page-context-safe helper modules.
7. Replace source-string checks with behavior-driven fixtures where practical.
8. Add a first-run quickstart command that prints the shortest safe setup path.
9. Add a `doctor --first-run` mode focused on setup blockers.
10. Add `verify-release` that runs pack, audit, docs, live smoke when available, and status.
11. Add a machine-readable maintainer health report.
12. Add a compact "which tool should I use?" HTML/Markdown cheat sheet.
13. Add MCP resource for first-run setup only.
14. Add a local artifact cleanup helper.
15. Add artifact retention docs and default paths.
16. Add smoke coverage for iframe/shadow DOM diagnostics.
17. Add compatibility matrix for Chrome versions and MV3 APIs.
18. Add an extension permission explainer generated from manifest permissions.
19. Add examples for common logged-in dashboards without naming private services.
20. Add command complexity metadata to the registry.
21. Add check budgets for stdout size on large-output commands.
22. Add an install doctor for MCP config files.
23. Add a safer "background mode" note and tests around avoiding focus stealing.
24. Add regression fixture for saved tab group cleanup.
25. Add fixture-backed tests for pricing/article/product presets from real-page patterns.
26. Add CodeQL/security scan interpretation docs.
27. Add contribution guide for adding a new command end-to-end.
28. Add release checklist for npm + Chrome Web Store + GitHub release.
29. Add generated architecture map from registry and imports.
30. Add a "use another tool when..." decision table.

Critical evaluation:

- Ideas 4, 5, and 6 are very valuable but too large to finish safely inside the Idea Wizard step. They should feed later reorganization/refactor skills.
- Ideas 3 and 10 overlap. A release wrapper is useful, but it touches CLI command surface and registry/docs; it should be implemented only after the plan synthesis step.
- Ideas 8, 9, 12, and 13 are good UX ideas, but they are less urgent than preventing maintenance drift.
- Ideas 14 and 15 are useful if artifact accumulation becomes a repeated complaint; not top priority yet.
- Ideas 16, 17, 18, 21, 22, 23, 24, and 25 are good future verification tracks, but each needs focused test design.
- Ideas 19, 26, 28, 29, and 30 are useful documentation/distribution polish, but not the highest leverage right now.
- Ideas 1, 2, 7, 11, and 27 pass the immediate-value test because they improve maintainability, reduce future mistakes, and can be checked automatically without changing browser behavior.

Top ideas selected for immediate implementation:

1. Maintenance-quality doc and checker.
2. Zod dependency strategy note.
3. Source-string-check migration guidance.
4. Machine-readable maintainer health report through the checker output.
5. Contribution guidance for adding/changing command surfaces safely.

Expected impact:

- Confidence: 90%.
- Downsides: This adds another checker, so it must stay lightweight and avoid becoming a second rigid regex court.
- Mitigation: The checker should report budgets and required docs, not block every line-count increase unless the project deliberately tightens budgets later.

Implemented now:

- Added `docs/MAINTAINABILITY.md`.
- Added `scripts/checks/release/check-maintainability.mjs`.
- Added `npm run check:maintainability`.
- Added the maintainability checker to `npm run check`.
- Documented the new checker in the README verification section.

Verification:

- `node --check ./scripts/checks/release/check-maintainability.mjs`
- `npm run check:maintainability`
- `npm run check:docs`
- `npm run check:pack`

## 6. 100-to-10 Filter

Skill: `/jef_hundred_to_ten_filter`

Plan:

- Explore a broad set of possible improvements across product, agent UX, safety, reliability, performance, docs, packaging, and maintainability.
- Ruthlessly reject ideas that add complexity without strengthening the local-first real-Chrome niche.
- Keep the 10 best ideas for synthesis and later implementation.

Ten best ideas:

1. `verify-release` orchestration command.

   A single local command that runs static checks, pack/audit, optional extension reload, live doctor, runtime smoke summary, and final git status. It should be explicit about when live Chrome is required and should preserve artifact paths. This turns the existing strong verification pieces into one memorable workflow.

2. CLI module extraction by command family.

   Split `bin/cli/main.mjs` into bridge client, argument parsing, output/artifact helpers, local setup commands, browser command payload builders, runtime smoke, and self-test. Keep `bin/chrome-bridge.mjs` stable.

3. MCP module extraction by tool family.

   Split `mcp/server/main.mjs` into schemas, bridge client, profiles, prompts, resources, local tools, read tools, mutation tools, artifact tools, and private-data tools. Keep `mcp/chrome-bridge-mcp.mjs` stable.

4. Agent-first quickstart mode.

   Add a compact command or MCP resource that returns the next safest action for the current state: extension not loaded, bridge stale, no scoped tab, page too large, private data requested, or live smoke pending.

5. Behavior-first checker helpers.

   Extract fake bridge/MCP/CLI helpers from large checkers so new tests can be written as behavior scenarios instead of source-string scans.

6. Page-context-safe injected helper split.

   Gradually split `extension/page-scripts/main.js` by injected capability while preserving `chrome.scripting.executeScript` behavior. Start with selector/element-ref helpers only if tests prove no closure/import regressions.

7. Artifact lifecycle manager.

   Add local artifact inventory, cleanup, and retention metadata so agents can safely use artifact-first workflows without leaving confusing piles in `/tmp`.

8. Output budget enforcement.

   Add testable stdout/MCP response budgets for commands that can emit large page data. Every large-output command should prefer counts, paths, hashes, and snippets by default.

9. First-run installer diagnostics.

   Add a focused setup diagnostic that checks Node version, package install, Native Messaging Host, extension path, unpacked extension status, MCP config files, and recommended profile for the detected client.

10. Client compatibility fixtures.

   Turn Claude Code, Cursor, Codex, VS Code, Windsurf, Hermes, and generic stdio examples into fixture-validated compatibility cases, including compact profile behavior and path replacement instructions.

Filter result:

The best ideas are mostly workflow and maintainability multipliers, not new browser superpowers. This is the right shape for the project: make the safe local bridge easier to run, easier to verify, easier for agents to choose correctly, and easier for maintainers to change.

## 7. Multi-Model Synthesis

Skill: `/jef_multi_model_synthesis`

Plan:

- Treat the previous skill outputs as competing plans and perspectives.
- Preserve the best parts of each: primer evidence, weakness prioritization, candid product opinion, premortem risk control, idea wizard implementation, and 100-to-10 filtering.
- Produce one unified architectural execution plan.

Unified plan:

### Principle 1: Protect The Product Boundary

Chrome MCP Bridge should remain the safest local real-Chrome MCP bridge for user-owned logged-in sessions. Do not blur it into a hosted browser platform, crawler, CAPTCHA tool, stealth browser, or unattended account operator.

Implementation consequences:

- Keep stdio MCP as the default current transport.
- Keep Streamable HTTP as explicit future opt-in work with Origin/DNS rebinding/auth requirements.
- Keep cloud/scale docs as "use another tool when..." guidance unless product direction intentionally changes.
- Keep confirmation and sensitive-confirmation gates non-negotiable.

### Principle 2: Make First Success Shorter

The project can be powerful without making the first five minutes feel like a compliance binder.

Implementation sequence:

1. Keep README top path short and safe.
2. Add or improve first-run diagnostics after core refactors.
3. Keep client-specific MCP snippets current.
4. Prefer compact MCP profiles for clients with tool-list sensitivity.
5. Make `doctor`, `session-summary`, and MCP guidance point to the next safest action.

### Principle 3: Reduce Maintenance Concentration Before Adding Major Features

The next architecture work should shrink hot spots while keeping public wrappers stable.

Priority order:

1. CLI internals:
   - Extract bridge HTTP client and timeout handling.
   - Extract output/artifact helpers.
   - Extract local setup/config commands.
   - Extract runtime smoke/self-test helpers only after smaller helpers land.
2. MCP internals:
   - Extract bridge client helpers.
   - Extract schemas by concern.
   - Extract prompts/resources/profile helpers.
   - Extract tool groups by safety tier or behavior family.
3. Checker internals:
   - Extract fake bridge/client helpers.
   - Move repeated JSON parsing and command invocation helpers into checker libs.
   - Prefer behavior scenarios for new checks.
4. Page scripts:
   - Split only after establishing tests that prove `chrome.scripting.executeScript` compatibility.
   - Start with pure selector/element-ref helpers if safe.

### Principle 4: Turn Verification Into A Workflow, Not A Memory Test

The existing checks are strong. The weakness is that release verification still requires the maintainer to remember a sequence.

Implementation sequence:

1. Keep `check:maintainability` as the lightweight health report.
2. Add a future `verify-release` command or script that orchestrates:
   - `npm run check`
   - `npm run check:pack`
   - `npm run check:audit`
   - optional extension reload
   - `doctor --live-checks`
   - `runtime-smoke --summary-only --out <file>`
   - final `git status`
3. Make live steps explicit and skippable when another session is using the bridge.

### Principle 5: Make Agent Token Hygiene A Default

Agents should not have to rediscover cheap-first usage every session.

Implementation sequence:

1. Keep large outputs artifact-first.
2. Add or strengthen output-budget checks for commands that can dump page content.
3. Update the bundled `codex/skills/chrome-bridge/SKILL.md` when workflows change.
4. Prefer `page-search`, `grep-page`, `links`, `tables`, and `read-artifact` in docs and prompts.

### Principle 6: Modernize Dependencies Deliberately

Do not upgrade Zod v3 to v4 as an opportunistic cleanup. Treat it as a compatibility migration with MCP schema verification.

Implementation sequence:

1. Keep the Zod v3 decision documented in `docs/MAINTAINABILITY.md`.
2. Add a migration spike only if MCP SDK/client compatibility is confirmed.
3. Run full static, package, audit, and live smoke checks before any dependency migration release.

Synthesis result:

The "ultimate" plan is not a giant feature sprint. It is a safety-preserving maintainability sprint: reduce hot spots, make verification easier to run, make first success simpler, and keep the local-first product boundary crisp. After that foundation, bigger features become safer to add.

## 8. Code Reorganizer

Skill: `/jef_code_reorganizer`

Plan:

- Respect the already completed primary reorganization wave instead of starting a risky second big-bang move.
- Look for a small no-brainer structural improvement that supports later checker/refactor work.
- Preserve all public entrypoints and runtime behavior.
- Verify the change with targeted checks.

Implemented now:

- Added `scripts/checks/lib/file-metrics.mjs`.
- Moved reusable project-file reading and line-count helpers out of `check-maintainability`.
- Updated `scripts/checks/release/check-maintainability.mjs` to consume the helper.
- Added `node --check ./scripts/checks/lib/file-metrics.mjs` to the full `npm run check` syntax chain.

Why this was the right size:

The main codebase already had a fresh wrapper-preserving reorganization. Another broad move before bug/performance/review passes would add churn. This extraction is deliberately small, creates a sensible shared checker helper, and supports the next wave of behavior-first checker refactors.

Verification:

- `node --check ./scripts/checks/lib/file-metrics.mjs`
- `node --check ./scripts/checks/release/check-maintainability.mjs`
- `npm run check:maintainability`

Code reorganizer result:

The repository structure is now incrementally better without widening runtime risk. The next meaningful reorganization should target CLI/MCP helper extraction with dedicated RED/GREEN boundary checks.

## 9. Stub Eliminator

Skill: `/jef_stub_eliminator`

Plan:

- Search for TODO, FIXME, HACK, stub, mock, placeholder, dummy, fake, demo-only, and not-implemented markers.
- Classify each match as production stub, test fixture, documentation placeholder, UI placeholder field, or intentional future boundary.
- Replace any production stubs with working code.
- Record false-positive categories so future scans are easier to interpret.

Findings:

- No production runtime stubs were found.
- `placeholder` matches are legitimate browser/form concepts, CLI/MCP filter fields, or example path placeholders in MCP client config fixtures.
- `fake` and `mock` matches are test/checker fixtures used to avoid touching live Chrome.
- `Not implemented in this release` appears in Streamable HTTP and cloud/scale docs and is an intentional product-boundary statement, not a runtime stub.
- `return null`, `return undefined`, and thrown errors inspected in runtime code are validation, parsing, optional-value, or fail-closed paths rather than unfinished implementations.

Stub eliminator result:

No code replacement was required. The project does not currently appear to ship placeholder production behavior under the searched markers. The remaining "not implemented" areas are explicit strategy boundaries and should stay documented that way unless product direction changes.

## 10. Bug Hunter

Skill: `/jef_bug_hunter`

Plan:

- Re-read the new files and adjacent package/docs/check boundaries with fresh eyes.
- Look for obvious integration drift, not just syntax errors.
- Fix confirmed issues immediately.
- Verify the corrected path.

Bug found:

The new maintainability checker and guide were added to `package.json` and README, but the package-content guardrails did not yet require:

- `docs/MAINTAINABILITY.md`
- `scripts/checks/release/check-maintainability.mjs`
- `scripts/checks/lib/file-metrics.mjs`

Why it mattered:

The files would still be included by broad `docs/` and `scripts/` package globs, but `check:pack` would not fail if a future package-files change accidentally dropped them. Since the README documents `check:maintainability`, the package guardrail should protect it explicitly.

Fix implemented:

- Added the maintainability doc, checker, and helper to `scripts/package/check-package-contents.mjs` required files.
- Added the same required-file assertions to `scripts/checks/contracts/check-command-registry.mjs`.

Verification:

- `npm run check:registry`
- `npm run check:pack`
- `node --check ./scripts/package/check-package-contents.mjs`
- `node --check ./scripts/checks/contracts/check-command-registry.mjs`
- `git diff --check`

Bug hunter result:

One real integration bug was found and fixed. No runtime behavior bug was found in the new maintainability helper/checker path.

## 11. Peer Code Reviewer

Skill: `/jef_peer_code_reviewer`

Plan:

- Review the current diff as if it was produced by another agent.
- Check package/docs/check integration, maintainability, security, and regression risk.
- Fix any confirmed issues.
- Record residual risks.

Review findings:

- No additional blocking issue found after the Bug Hunter package-guardrail fix.
- The new maintainability checker is read-only and uses local repository files only.
- The new helper does not touch runtime browser, MCP, CLI command dispatch, credentials, network, or Chrome APIs.
- `check:maintainability`, `check:registry`, and `check:pack` pass after the guardrail fix.

Residual risks:

- The full `npm run check` should still be run after all remaining skill passes, because later documentation and checker changes may interact with broader source-string assertions.
- Live runtime smoke is not required for the maintainability/doc/checker changes themselves, but the deployment verifier skill should decide whether to run it at the end.

Peer review result:

The current change set is coherent and low-risk. It improves maintainability visibility and package guardrails without changing browser behavior.

## 12. Deep Performance Audit

Skill: `/jef_deep_performance_audit`

Plan:

- Establish a small baseline for representative local workflows touched by this pass.
- Capture at least one CPU profile for the new checker path.
- Only implement an optimization if there is a proven hotspot, clear equivalence oracle, and low-risk isomorphic diff.

Baseline commands:

- `/usr/bin/time -l npm run check:maintainability`
  - Real time: about 0.29s.
  - Max resident set size: about 70 MB.
  - Output: `ok: true`.
- `/usr/bin/time -l npm run check:pack`
  - Real time: about 1.76s.
  - Max resident set size: about 108 MB.
  - Output: `ok: true`.
- `/usr/bin/time -l npm run self-test`
  - Real time: about 1.09s.
  - Max resident set size: about 70 MB.
  - Output: `ok: true`, 362 checks, 0 failures.
- `node --cpu-prof --cpu-prof-dir=/tmp/chrome-bridge-prof ./scripts/checks/release/check-maintainability.mjs`
  - CPU profile written under `/tmp/chrome-bridge-prof`.
  - Output: `ok: true`.

Performance analysis:

- The new maintainability checker is not a meaningful runtime or CI bottleneck.
- `check:pack` is slower because it intentionally shells out to `npm pack --dry-run` and validates the tarball contents. That cost is acceptable because it protects publishing correctness.
- `self-test` remains reasonably fast for the amount of source and parity checking it performs.
- No N+1 fetch/query pattern, serialization hot spot, queue contention, or memory growth issue was identified in the new code path.

Optimization decision:

No performance code change was made. The evidence does not justify optimizing the new checker. The best performance guidance remains product-level: keep large browser/page outputs artifact-first and keep full runtime smoke summary-only in agent sessions.

Performance audit result:

No gross inefficiency was found in the changes from this skill chain. Future performance work should focus on output-size budgets and runtime-smoke/report verbosity rather than micro-optimizing small checker helpers.

## 13. E2E Pipeline Validator

Skill: `/jef_e2e_pipeline_validator`

Plan:

- Run the full local verification pipeline after the new docs/checker/package changes.
- Treat failures as blockers before moving to live deployment verification.
- Record the exact result.

Execution:

- Ran `npm run check`.

Result:

- Passed.
- `self-test`: 362 checks, 0 failures.
- `check:registry`: 52 extension actions, 81 CLI commands, 71 MCP tools.
- `check:pack`, package contents, privacy scan, docs checks, CLI/MCP local checks, module-boundary checks, feature checks, and the new `check:maintainability` all passed inside the full pipeline.

E2E pipeline result:

The local end-to-end verification pipeline is green. Live Chrome verification remains for the deployment verifier skill.

## 14. Deployment Verifier

Skill: `/jef_deployment_verifier`

Plan:

- Interpret deployment for this project as the Native Messaging Host plus unpacked Chrome extension plus real Chrome runtime smoke.
- Reload the extension.
- Run live doctor.
- Run live runtime smoke summary with an artifact path.
- Record the result.

Execution:

- `node ./bin/chrome-bridge.mjs reload-extension --confirm`
- `node ./bin/chrome-bridge.mjs doctor --live-checks`
- `node ./bin/chrome-bridge.mjs runtime-smoke --summary-only --out /tmp/chrome-bridge-runtime-smoke-jeffrey.json`

Result:

- Live doctor passed.
- Bridge version: `0.4.1`.
- Extension version: `0.4.1`.
- Extension transport: Native Messaging.
- Runtime smoke passed.
- Runtime smoke steps: 59.
- Runtime smoke failures: 0.
- Required live coverage: 32/32.
- `finalVerificationComplete`: true.
- Artifact: `/tmp/chrome-bridge-runtime-smoke-jeffrey.json`.

Deployment verifier result:

The live local deployment is healthy after the current change set.

## 15. README Reviser

Skill: `/jef_readme_reviser`

Plan:

- Update docs to describe the current state, not as a "newly added" feature.
- Ensure the maintainability guide and checker are discoverable.
- Verify docs and package checks after documentation edits.

Implemented now:

- Added `docs/MAINTAINABILITY.md` to the README documentation table.
- Added `npm run check:maintainability` to the CONTRIBUTING development command list and pull request checklist.
- Added a CONTRIBUTING note pointing command-surface, checker, dependency, and module-boundary work to the maintainability guide.

Verification:

- `npm run check:docs`
- `npm run check:maintainability`
- `npm run check:pack`
- `git diff --check`

README reviser result:

The public docs now describe the maintainability surface as part of the current project workflow.
