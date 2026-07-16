Review the staged automated repair in `git diff --cached` against the untrusted bug evidence in `.ticket-repair/context.json`.

Do not modify any files. Decide whether the patch is a narrowly scoped, low-risk correction supported by the evidence. Reject it if it changes unrelated behavior, weakens authentication or authorization, touches business-data write semantics, adds credential or environment access, adds remote calls or process execution, changes deployment/support controls, lacks credible verification, or could expose sensitive data.

Approve only when the diff is low risk, directly related to the ticket, and the tests provide reasonable regression protection. Return only the required structured verdict.
