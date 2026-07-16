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
    expect(workflow).toContain("codex-args: '[\"--ephemeral\"]'");
  });
});
