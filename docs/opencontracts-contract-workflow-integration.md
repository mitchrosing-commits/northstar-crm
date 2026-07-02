# OpenContracts contract workflow integration note

Northstar should treat OpenContracts as a future document layer around the existing deal-scoped NDA -> MSA -> SOW workflow, not as a replacement for local CRM status tracking.

Potential fit:

- Templates: use OpenContracts to store and select NDA, MSA, and SOW templates once Northstar has a controlled template library and merge-field model.
- Document handling: link generated or uploaded documents back to `DealContractStep.externalReference` so CRM users can keep pipeline context without making Northstar the document repository.
- Review and extraction: map OpenContracts corpus/document metadata into deal timeline events, notes, or contract-step status updates after the API boundary is proven.
- Signatures: integrate only through a confirmed OpenContracts-supported signing path or a separate e-signature provider; the current CRM should continue to record sent/signed dates and local blockers.

Likely CRM-to-OpenContracts mapping:

- Workspace -> OpenContracts organization or tenant boundary.
- Deal -> matter/project/corpus context.
- Deal participants, organization, owner, value, currency, close date, and products/line items -> template variables.
- `DealContractStep.type` -> template/document category.
- `DealContractStep.status`, owner, due/sent/signed dates, notes, and external reference -> local CRM workflow fields that may subscribe to document events later.

Risks and unknowns:

- Tenant/workspace isolation, auth model, and API maturity need a proof-of-concept before production use.
- Template variables, clause libraries, redlining, approvals, and signature handoff need clear ownership between Northstar, OpenContracts, and any e-signature provider.
- Document storage, retention, auditability, and customer data handling need security review.
- Event sync must be idempotent so OpenContracts updates do not overwrite intentional CRM statuses or blockers.

Near-term boundary:

- Keep local NDA -> MSA -> SOW workflow authoritative for pipeline visibility, next actions, ownership, audit logs, and demo readiness.
- Use `externalReference` as the only bridge field until a real integration design exists.
