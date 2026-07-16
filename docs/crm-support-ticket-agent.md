# CRM support ticket agent

The authenticated `/support` page accepts MeadowBrook CRM tickets and places every valid submission in a durable SQLite queue on the existing Render disk.

## Workflow

1. The signed-in employee submits a ticket and may attach screenshots, photos, PDFs, text, CSV, or log files. Their canonical name and `@meadowb.com` address are resolved server-side from the authenticated login and employee directory; the form never accepts requester identity fields.
2. The queue worker sends an acknowledgement from the configured support mailbox, including the submitted attachments.
3. The worker checks only these local CRM signals:
   - `/api/healthz`
   - `/api/runtime/health-slo`
   - `/api/sync/status`
4. OpenAI returns a strict structured diagnosis and one of three remediation choices: `none`, `refresh_read_model`, or `code_repair`. Supported screenshots and photos are included as untrusted supporting evidence; HEIC files and non-image attachments remain on the ticket but are not sent to the diagnostic model for image analysis.
5. Deterministic server-side gates decide whether a cache refresh or isolated code-repair job may start.
6. A code repair runs in GitHub Actions using the official Codex action, without repository-write credentials. The resulting patch must pass deterministic diff restrictions, the full tests, production build, lint, and a separate read-only low-risk review.
7. A separate credential-isolated job reapplies the exact patch, repeats verification, and pushes it to `main`. Render auto-deploys it, and the workflow waits for `/api/health` to report the exact commit before declaring success.
8. The worker replies on the Gmail thread created for that ticket and polls only that stored thread ID.
9. The employee is asked to reply with `resolved` or `still broken`. The ticket closes only after an explicit resolution confirmation.

The agent never searches or reviews the mailbox. It reads only Gmail thread IDs that it created for submitted support tickets.

## Attachments

- Up to 5 files may be attached to a ticket.
- Each file may be up to 6 MB, with a 12 MB combined limit so the acknowledgement remains within normal email limits.
- Accepted formats are JPEG, PNG, WebP, GIF, HEIC/HEIF, PDF, plain text, CSV, and log files.
- Attachment names are sanitized, file types are validated in both the browser and API, and executable or unknown formats are rejected.
- Files are stored under `support-ticket-attachments/` beside `READ_MODEL_SQLITE_PATH`. On Render this resolves to the existing `/app/data` persistent disk.

## Automated repair boundary

The local read-model refresh is allowed only when:

- the ticket concerns Accounts, Contacts, or Performance;
- the ticket describes missing, stale, blank, or non-loading data;
- sync diagnostics show a failed or stale sync; and
- the same refresh has not already been attempted for the ticket.

For a reproducible frontend or backend application defect—including API routes, server libraries, background workers, and runtime errors—the diagnostic model may request `code_repair`. The verified commit is pushed to `main`, causing the existing Render service to rebuild and redeploy. That request is limited as follows:

- no more than two repair jobs may be dispatched for one ticket;
- questions never dispatch code repair;
- ticket content and attachments remain untrusted data;
- the coding job has workspace-write access but no GitHub write credential;
- changes to workflows, deployment configuration, package manifests, environment files, authentication, mail authentication, and the ticket automation itself are blocked;
- new environment access, process execution, dynamic code execution, raw HTML injection, remote deployment access, symlinks, binary changes, diffs over 24 files, or diffs over 1,600 lines are rejected;
- the complete tests and production build run before and after credential separation, and every changed code file must pass lint with zero warnings;
- an independent read-only Codex review must return an approved, low-risk structured verdict;
- the publisher uses a normal non-force push, so a concurrent change to `main` causes the repair to stop;
- Render must report the exact commit as healthy within 15 minutes; otherwise the publisher reverts it when `main` has not moved.

The coding agent cannot access GitHub write credentials, Render credentials, or the callback secret. The publisher never receives the Codex API key. The robot still cannot edit source CRM business records, change credentials, or perform arbitrary infrastructure operations.

## Required production configuration

- `MAIL_SERVICE_URL`, `MAIL_SERVICE_SHARED_SECRET`, and `MAIL_PROXY_SHARED_SECRET`
- an existing connected Gmail mailbox for `TICKET_AGENT_SENDER_EMAIL`
- `OPENAI_API_KEY` for model-backed diagnosis (the worker has a conservative deterministic fallback)
- the existing persistent `READ_MODEL_SQLITE_PATH`

The Render blueprint adds the remaining `TICKET_AGENT_*` settings. `TICKET_AGENT_SECRET` is generated by Render and protects optional external calls to the queue-processing endpoint; the in-process worker uses the loopback interface.

Code repair additionally requires:

- the committed `.github/workflows/crm-ticket-repair.yml` workflow on the default branch;
- GitHub Actions secret `CODEX_OPENAI_API_KEY`;
- the same high-entropy `TICKET_REPAIR_CALLBACK_SECRET` in GitHub Actions and Render;
- a fine-grained Render secret `TICKET_REPAIR_GITHUB_TOKEN` limited to Actions write access for this repository; the production app uses it only to invoke `workflow_dispatch` and it cannot write repository contents;
- optional GitHub repository variable `CRM_TICKET_APP_BASE_URL` when the CRM origin differs from `https://sales-meadowb.onrender.com`; callback and evidence URLs are constructed from this trusted variable rather than dispatch or ticket input;
- `TICKET_REPAIR_ENABLED=true` only after those secrets are installed; and
- branch policy that permits the workflow publisher job to push a verified commit to `main`.

## Pre-vacation smoke test

1. Sign in and open `/support`.
2. Submit a low-impact test ticket to your own `@meadowb.com` address.
3. Confirm the acknowledgement and investigation update arrive on one Gmail thread.
4. For a dedicated test defect, confirm the ticket moves to Repairing & validating and the GitHub workflow runs.
5. Confirm the workflow tests the patch, publishes it, and waits for the exact Render commit.
6. Confirm the deployed-update email arrives on the original thread.
7. Reply `resolved` and confirm the ticket status changes to Resolved.

Set `TICKET_AGENT_ENABLED=false` to stop immediate and scheduled ticket processing without removing submitted tickets from the queue.
Set `TICKET_REPAIR_ENABLED=false` to keep diagnostics and cache refreshes active while disabling all repository changes and deployments.
