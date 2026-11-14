---
name: council
description: Independent judging of a Reddit Tweaks change or feature by Claude Code subagents with fixed roles and models (mapper, per-surface auditors, visual reviewer, release auditor), followed by main-agent verification of every claim. Takes the user's own focus items ("test X") plus autonomous discovery on every surface the testers pass through, or focus-only when asked. Use after automatic checks pass in the verify-loop, before a release, or when asked to "review", "judge", "audit", "test these things" or "get a second opinion" on extension UI or behaviour.
---

# Council (Claude-only judging)

The council finds what the automatic checks missed: does it look and behave like native Reddit, are the functions right, are there timing or loading problems. Members are Claude Code subagents with fixed roles. **The main agent verifies every claim before anything is fixed or reported.** Judges do make mistakes: in the trial, Opus raised a high-severity false alarm caused by a throttled test window.

Tools: `.claude/skills/verify-loop/reference/tools.md`. Prompt templates: `prompts/`. The evidence behind the model choices: [reference/trial-2026-11-04.md](reference/trial-2026-11-04.md).

## Roles (fixed)
| Role | Agent call | Model | Runs in | Why this model |
|---|---|---|---|---|
| **Mapper**: feature map and code lifecycle audit | `subagent_type: "Explore"` | `haiku` | routine + release; once per feature, reused until the feature code changes | 2026-11-04: 9.5/10 on a pre-registered list of the archive's code paths, including the nav teardown, notice remount and bridge queue, plus new search risks (152k tokens, 22 calls, 3 min). One run; Sonnet was not compared. |
| **Surface auditor**: one per touched surface, max 4 | `subagent_type: "general-purpose"` | `haiku` | routine + release | With the full-test prompt and one narrow surface: 77% severity-weighted recall, 0 false positives, 6.5/8 of the user's own issues. A single long prompt for everything diluted it (59%), hence one auditor per surface. |
| **Visual reviewer**: code-blind, looks only at the contact sheet and inventory diffs | `general-purpose` | `haiku` (routine), `opus` (release) | both | Haiku's eyeball verdicts were unreliable (it called a misaligned button "aligned"), so its verdicts must cite a measurement. Opus caught the most visual and polish issues. |
| **Release auditor**: whole feature, all surfaces | `general-purpose` | `opus` | release only | 91% severity-weighted recall even with a light prompt; the best on post-page details. |
| **Verifier and grader** | main agent | n/a | always | Reproduces every claim, rejects environment artefacts, merges duplicates. |

## What you can ask for (inputs)
| Input | What it does |
|---|---|
| **Focus items** (from the user, optional) | Things the user wants tested, in their own words, for example "card styles vs Reddit's", "does search find older posts", "read-only post page". Each becomes F1…Fn. Auditors test every focus item first and report a verdict with evidence for each. Pass them verbatim; don't add your own suspicions. |
| **Regression list** (optional) | Previously verified issues to re-check (start from `reference/trial-*.md`). Checked after the focus items. |
| **Explore mode** | `explore` (default): after the focus items and regressions, auditors look for problems on their surface **and on every surface they pass through** (for example, the feed cards seen while testing the nav). Each passed-through surface gets at least one native-vs-ours inventory diff. `focus-only`: test only the focus items and regressions, with no open discovery; anything severe noticed in passing goes in `incidental`, unexamined. |

Pick the mode from the user's words: "only check X" or "just X" means `focus-only`; otherwise use `explore`. If the user gives focus items with no surface, the main agent maps each item to the surfaces it touches and assigns auditors accordingly.

Never give judges the answer key or your own suspicions. The only exceptions are the user's focus items and the regression list, which are passed as separate sections.

## Routine mode (per change, after L2 passes)
1. **Map** (skip if `artifacts/research/verify/<feature>/feature-map.md` exists and the feature code is unchanged since): run the Mapper with `prompts/mapper.md`. The Explore agent can't write files, so save its reply as `feature-map.md`.
2. **Evidence for the visual reviewer** (main agent, cheap): `probe-sheet` with native next to ours for each touched surface, plus `probe-inventory` output for both.
3. **Auditors**: one Surface auditor per touched surface with `prompts/auditor.md`, filled with the surface name, the feature map, the native counterpart, the level (L2 fixture URL on port 9334, or L3), the focus items, the regression list and the explore mode. A focus item that names an untouched surface (for example "card styles" during a nav change) gets its own auditor.
   - At L2 (headless, throttling off) auditors may run **in parallel**, each in its own tab.
   - At L3 run them **one at a time** in one foreground tab, or **in parallel (2–3)**, one window per agent with focus emulation on, each window checked for rendering first (tools.md, "Parallel agents at L3"). A background tab, or a page that fails the frame check, produces false "didn't load" claims. The user must have approved the relay prompt.
4. **Visual reviewer** with `prompts/visual.md`: the contact sheet path, the inventory diffs and spec.md. Give it no code and no browser.
5. **Verify** (below), then return the verified, in-scope issues to the verify-loop.

## Release mode (before packaging a release)
Routine mode for every surface of the changed features, plus the **Release auditor** (`prompts/release.md`, at L3 after the user approves the relay) and the visual reviewer on `opus`. Run the L3 members sequentially.

## Verify and grade (main agent, always)
For every claimed issue:
1. **Reproduce it** with a probe (inventory, ui, timeline, a targeted eval, or the Arctic Shift record). Every high-severity claim must be reproduced before you act on it.
2. **Rule out artefacts**: was the tab visible (`visibilityState`)? Does native Reddit do the same on the equivalent page? Was it a direct load where a user would click (or the reverse)? Was it live data drift?
3. Classify each claim as **true**, **false** or **unverifiable**, and merge duplicates across judges. Add any real issue that every judge missed.
4. Record per role: model, tokens, tool calls and duration (from the Agent result's usage), and the counts of true, false and unverifiable claims. These go in the `council` section of `validation.json`.
5. In-scope true issues go back to the fix loop. Everything else goes on the open-issues or out-of-scope list.

## Judge output schema (all roles except the Mapper)
```json
{"surface":"…","mode":"explore|focus-only",
 "focus":[{"id":"F1","item":"the user's words","verdict":"pass|fail|unsure","evidence":"measured value / command / file"}],
 "passed_through":["surface: inventory diff summary (missing / extra / different)"],
 "incidental":["focus-only mode: severe things noticed but not examined"],
 "checked":["case: result"],"not_tested":["case: reason"],
 "per_expectation":[{"id":"X1|S1|E1","verdict":"pass|fail|unsure","evidence":"measured value / command / file"}],
 "issues":[{"severity":"high|med|low","where":"surface/region","claim":"…","evidence":"inventory lines, timeline rows, request+status, screenshot path",
   "native_checked":"what native Reddit does here","reverified":true,"recoverable":"yes from <field/URL> | no | n/a","fix":"…"}],
 "score_out_of_10":0}
```
Severity: high = broken, misleading or data shown wrongly; med = a clearly visible defect or functional gap; low = polish.

## Re-running the model trial
Re-run the trial when a new model comes out or a role keeps missing verified issues. Same feature, same prompt per model. Write the answer key **before** reading any judge output. Grade every claim against it and verify disputed claims live. Score true and false positives, severity-weighted recall (high 3, med 2, low 1), invented details, tokens and time. Run the members **sequentially** in one foreground tab (or at L2). Then update the Roles table and `reference/trial-*.md`.
