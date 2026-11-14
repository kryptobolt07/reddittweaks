# Archived skills (inactive)

Claude Code loads skills only from `.claude/skills/<name>/SKILL.md`. Folders here are kept for reference and are **not** loaded.

| Folder | What it is | Archived |
|---|---|---|
| `council/` | Independent judging by Claude subagents with fixed roles: a mapper, one surface auditor per touched surface, a visual reviewer, a release auditor. The main agent verifies every claim afterwards. Includes the 2026-11-04 model trial. | 2026-11-14 |
| `verify-loop-with-council/` | The verify-loop as it was before 2026-11-14. Its step 4 runs the council after the fixture level, and its release step runs the council in release mode. | 2026-11-14 |

**Why archived:** the user found the direct, measured workflow used for the 0.32.0 work worked better for now. That's the active `.claude/skills/verify-loop/`: capture Reddit's own component with computed-style dumps, build with Reddit's markup, run unit tests, do targeted live comparisons, and have the main agent verify its own work.

## Switching back to the council workflow

1. Move the council back into place: `git mv .claude/skills-archived/council .claude/skills/council`.
2. Swap the verify-loop versions:
   - `git mv .claude/skills/verify-loop .claude/skills-archived/verify-loop-measured`
   - `git mv .claude/skills-archived/verify-loop-with-council .claude/skills/verify-loop`
   - In the restored `SKILL.md`, set `name: verify-loop` again.
   - Point its tools link at the moved `reference/tools.md`: `git mv .claude/skills-archived/verify-loop-measured/reference .claude/skills/verify-loop/reference` and change the link back to `reference/tools.md`. Keep the newer `tools.md`.
3. In `AGENTS.md`, restore the sentence: "…use the `verify-loop` skill … and its `council` skill for judging (`.claude/skills/`). The council's roles use the Claude subagent types and models fixed in its SKILL.md; those override the default subagent model above for judging."
4. Restore the `council` block in `verify-loop/templates/validation.json` and the "User focus items … Council mode" section in `templates/spec.md`. Both are still in the archived copies.

You can also use the council once without switching: ask for "a council review". Its prompts and roles in `council/` still work as written, given the tools in `.claude/skills/verify-loop/reference/tools.md`.
