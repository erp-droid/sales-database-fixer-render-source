import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("CRM ticket repair workflow authentication", () => {
  it("keeps the Codex action proxy configuration enabled", () => {
    const workflow = readFileSync(
      path.join(process.cwd(), ".github/workflows/crm-ticket-repair.yml"),
      "utf8",
    );

    expect(workflow).not.toContain("--ignore-user-config");
    expect(workflow.match(/uses: openai\/codex-action@v1/g)).toHaveLength(2);
    expect(workflow.match(/uses: actions\/setup-node@v4/g)).toHaveLength(3);
    expect(workflow).toContain("codex-args: '[\"--ephemeral\"]'");
    expect(workflow).toContain("Expected Node 20 ABI 115");
    expect(workflow).toContain("needs: [repair, review]");
    expect(workflow).toContain("needs: [repair, review, deploy]");
    expect(workflow.indexOf("Restore the project Node runtime")).toBeGreaterThan(
      workflow.indexOf("Run isolated coding agent"),
    );
    expect(workflow.indexOf("Run full test suite")).toBeGreaterThan(
      workflow.indexOf("Restore the project Node runtime"),
    );
  });

  it("runs the repair agent and independent reviewer in separate fresh jobs", () => {
    const workflow = readFileSync(
      path.join(process.cwd(), ".github/workflows/crm-ticket-repair.yml"),
      "utf8",
    );
    const repairStart = workflow.indexOf("\n  repair:");
    const reviewStart = workflow.indexOf("\n  review:");
    const deployStart = workflow.indexOf("\n  deploy:");
    const repairJob = workflow.slice(repairStart, reviewStart);
    const reviewJob = workflow.slice(reviewStart, deployStart);

    expect(repairStart).toBeGreaterThan(-1);
    expect(reviewStart).toBeGreaterThan(repairStart);
    expect(deployStart).toBeGreaterThan(reviewStart);
    expect(repairJob.match(/uses: openai\/codex-action@v1/g)).toHaveLength(1);
    expect(reviewJob.match(/uses: openai\/codex-action@v1/g)).toHaveLength(1);
    expect(repairJob).not.toContain("Run independent read-only risk review");
    expect(reviewJob).toContain("sandbox: read-only");
    expect(reviewJob).toContain("safety-strategy: drop-sudo");
  });

  it("keeps autonomous code repair enabled in the Render blueprint", () => {
    const blueprint = readFileSync(path.join(process.cwd(), "render.yaml"), "utf8");

    expect(blueprint).toMatch(/- key: TICKET_REPAIR_ENABLED\s+value: "true"/);
    expect(blueprint).toMatch(/- key: TICKET_SUPPORT_OWNER_LOGINS\s+value: jserrano/);
  });
});
