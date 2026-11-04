# Spec: <change title>
Slug: <slug> · Branch: <branch> · Extension version at start: <manifest version>
Touched surfaces: <e.g. archive feed cards, archived post header>

## Expectations (what must be observably true after the change)
Each row says which level proves it and what the evidence will be. Write this BEFORE editing code.

| ID | Expectation (observable) | Level | Evidence that proves it |
|---|---|---|---|
| X1 | <e.g. Moving from the archive feed to a post keeps the left nav element: same #id, paint=self throughout> | L2+L3 | probe-timeline: nav region never shows `paint=div.left-sidebar` or a new #id; native comparison identical |
| X2 | <…> | L1 | node test `<file>`: "<test title>" |

## Standing checks (any UI change; mark n/a with a reason)
| ID | Check | Evidence |
|---|---|---|
| S1 | Works in full, floating and minimized chat (chat features) / feed, post and search routes (page features) | probe-ui + probe-shot per mode |
| S2 | Light and dark mode both use Reddit's own colour tokens | probe-inventory colours vs native in both themes |
| S3 | Nothing overflows or is clipped at the 380px floating width (and 1280px pages) | probe-ui beyondRoot / clipped = 0 (or same as native) |
| S4 | Menus and controls layer correctly (nothing covered) | probe-ui covered = 0; menus opened and hit-tested |
| S5 | No new console errors from the extension | probe-ui --console, `[extension]` lines = 0 |
| S6 | Reddit's own UI is unchanged outside the edited area | probe-pngdiff before/after with --mask on the edited area: outsideMask ≈ 0 |
| S7 | Loading labels never claim incomplete history or coverage is complete | text checks on every loading, partial, end and error state |
| S8 | Keyboard and focus work | probe-ui --tab: in-root order sensible, `ring` on every stop |
| S9 | Transitions match native: no flash, blank or element replacement on click, back, reload | probe-timeline per transition from the lifecycle audit, native vs ours |

## Transition cases (from the code lifecycle audit)
| From → to | How (click / back / reload / direct) | What the code does to which region | Expected |
|---|---|---|---|

## Data-to-UI fields (features that render records)
| Field in record | Shown where | Native format | Check |
|---|---|---|---|

## Out of scope (noticed, not changed in this loop)
- …
