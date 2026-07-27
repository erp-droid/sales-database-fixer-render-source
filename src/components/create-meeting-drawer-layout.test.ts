import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function zIndexFor(css: string, selector: string): number {
  const rule = css.match(new RegExp(`\\${selector}\\s*\\{[^}]*z-index:\\s*(\\d+)`, "s"));
  expect(rule, `${selector} should define a z-index`).not.toBeNull();
  return Number(rule?.[1]);
}

describe("create meeting drawer mobile stacking", () => {
  it("renders the modal above the fixed mobile navigation", () => {
    const componentDirectory = path.join(process.cwd(), "src", "components");
    const meetingCss = readFileSync(
      path.join(componentDirectory, "create-meeting-drawer.module.css"),
      "utf8",
    );
    const chromeCss = readFileSync(path.join(componentDirectory, "app-chrome.module.css"), "utf8");

    const mobileNavigationZIndex = zIndexFor(chromeCss, ".sidebar");
    const backdropZIndex = zIndexFor(meetingCss, ".backdrop");
    const drawerZIndex = zIndexFor(meetingCss, ".drawer");

    expect(backdropZIndex).toBeGreaterThan(mobileNavigationZIndex);
    expect(drawerZIndex).toBeGreaterThan(backdropZIndex);
  });
});
