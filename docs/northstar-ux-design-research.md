# Northstar UX Design Research

## Reference Extraction

Two supplied YouTube references were reviewed:

- `BH4PWNNYiUM`: "Enterprise UX Making a Difference from the Inside" by Designlab.
- `Oug_mN8lgH4`: "Top CRM UI/UX Design Patterns for Enterprise Applications" by Coders.

Transcripts were retrieved successfully with a temporary transcript utility. `yt-dlp` also retrieved subtitle files, thumbnails, and a few representative frames into `/tmp/northstar-reference-videos`. The captured frames were mostly presenter or stock footage rather than concrete dashboard/product UI, so the useful evidence was primarily conceptual: enterprise UX context, information-density tradeoffs, design systems, and CRM workflow patterns.

## Design Lessons

- Enterprise tools are role-focused work surfaces. They should optimize productivity, accuracy, and repeat use instead of borrowing consumer-app minimalism.
- Dense business data still needs hierarchy. Too much information creates cognitive load, but too little context makes users uncertain.
- Design systems matter more in enterprise software because tables, cards, forms, statuses, and handoffs repeat across many workflows.
- CRM UX should make the next sales action obvious: overdue work, missing next steps, stale deals, quote follow-ups, and contract blockers need visible paths to action.
- Trust comes from restraint: consistent spacing, stable navigation, honest integration states, readable tables, predictable forms, and status language that does not overpromise.

## Codex Workflow Findings

The current Codex guidance emphasizes supplying goal, context, constraints, and done-when criteria; using `AGENTS.md` for durable repo conventions; using focused skills for repeatable workflows; and validating changes with tests and review. For this task, the useful application was to keep the prompt constraints close, avoid migrations and integration fakery, change shared UI primitives first, and verify the result through type/lint/test/build/browser checks.

Potential future improvement: add a small repo-level `AGENTS.md` that captures Northstar-specific UI rules, verification commands, and "do not fake integrations" constraints so future design passes inherit the same quality bar automatically.

## Applied Direction

This pass prioritizes:

- A calmer visual system with stronger neutral surfaces, clearer focus states, and status colors for action semantics.
- A stable shell with active navigation, grouped work/system areas, and persistent workspace/settings affordances.
- A dashboard command-center layer for needs attention, open pipeline value, and today's work queue.
- A more scannable pipeline with summary metrics, stage counts, probabilities, card hierarchy, and clearer movement affordances.
- A deal workspace that reads as the primary sales surface through a stronger record subtitle and next-step emphasis.
- More consistent cards, tables, forms, empty states, provider cards, product cards, and responsive behavior across the app.
