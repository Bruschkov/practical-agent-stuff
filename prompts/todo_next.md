---
description: Plan the next coherent batch of TODOs
---
Read @TODO.md and inspect files relevant to the next incomplete work. Plan a coherent, session-sized batch, not just the smallest atomic step.

Start with the first incomplete step and include subsequent related steps that together deliver one concrete, verifiable outcome. Respect TODO order and dependencies; include the tests and integration needed to finish that outcome. Prefer a complete vertical slice over isolated edits, without filling a fixed task quota.

Keep the batch small enough to explain, implement, and review in one session. Stop before unrelated work, a separate major outcome, or an unresolved decision or dependency. A single step is fine if it already fills that scope; split an oversized step into a bounded slice rather than taking it all.

Present a concise overview with enough substance to question the approach before approving:
- **Next batch:** Name the concrete outcome and selected TODO steps; state the main scope boundary.
- **Planned approach:** Use a few short, concrete bullets for the main pieces of work. Explain consequential design choices, assumptions, or risks—not every implementation detail.
- **Verification:** Briefly describe how the outcome and its important failure cases will be checked, rather than listing every test or command.
- **Stopping point:** Explain why this completes a coherent outcome and what remains for a later batch.

Keep the investigation thorough, but the report selective. Omit exhaustive file lists, nested implementation plans, and routine check inventories; mention a file only when it helps explain a consequential choice. Expand details when asked. Surface unresolved decisions that need user input.

Plan only; wait for approval before implementing or marking TODOs complete.

If the TODO is missing, complete, ambiguous, or conflicts with the current code/configuration, say so and ask the smallest clarification needed.

Do not update durable docs unless the selected work explicitly requires it.
