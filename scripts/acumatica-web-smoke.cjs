#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function parseEnvFile(filePath) {
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function parseArgs(argv) {
  const options = {
    screenId: null,
    screenshotPath: path.join(process.cwd(), "tmp", "acumatica-web-smoke.png"),
    headed: false,
    restartApplication: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--screen-id") {
      const value = argv[index + 1];
      if (!value || !value.trim()) {
        throw new Error("--screen-id requires a value.");
      }
      options.screenId = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--screenshot") {
      const value = argv[index + 1];
      if (!value || !value.trim()) {
        throw new Error("--screenshot requires a value.");
      }
      options.screenshotPath = path.resolve(process.cwd(), value.trim());
      index += 1;
      continue;
    }

    if (arg === "--headed") {
      options.headed = true;
      continue;
    }

    if (arg === "--restart-application") {
      options.restartApplication = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage:",
          "  node scripts/acumatica-web-smoke.cjs [--screen-id SM203510] [--restart-application] [--screenshot tmp/file.png] [--headed]",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function login(page, env) {
  await page.goto(`${env.ACUMATICA_BASE_URL}/Frames/Login.aspx`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.locator('[name="ctl00$phUser$txtUser"]').fill(env.ACUMATICA_USERNAME);
  await page.locator('[name="ctl00$phUser$txtPass"]').fill(env.ACUMATICA_PASSWORD);

  const company = env.ACUMATICA_COMPANY?.trim();
  if (company) {
    const companyInput = page.locator('[name="CompanyID"], [name="ctl00$phUser$cmpCompany"]');
    if (await companyInput.count()) {
      try {
        await companyInput.first().fill(company);
      } catch {
        // Some tenants render company as a dropdown rather than a text input.
      }
    }
  }

  await Promise.all([
    page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }),
    page.locator('[name="ctl00$phUser$btnLogin"]').click(),
  ]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = parseEnvFile(path.join(process.cwd(), ".env.local"));
  if (!env.ACUMATICA_BASE_URL || !env.ACUMATICA_USERNAME || !env.ACUMATICA_PASSWORD) {
    throw new Error("ACUMATICA_BASE_URL, ACUMATICA_USERNAME, and ACUMATICA_PASSWORD are required.");
  }

  const browser = await chromium.launch({
    headless: !options.headed,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 1080,
      },
    });

    await login(page, env);

    if (options.screenId) {
      await page.goto(`${env.ACUMATICA_BASE_URL}/Main?ScreenId=${encodeURIComponent(options.screenId)}`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => undefined);
    }

    if (options.restartApplication) {
      if (options.screenId !== "SM203510") {
        throw new Error("--restart-application requires --screen-id SM203510.");
      }

      const restartButton = page.getByText("RESTART APPLICATION", { exact: true });
      await restartButton.waitFor({ state: "visible", timeout: 60000 });
      await restartButton.click();

      const confirmCandidates = [
        page.getByRole("button", { name: "OK" }),
        page.getByRole("button", { name: "Yes" }),
        page.getByText("OK", { exact: true }),
        page.getByText("Yes", { exact: true }),
      ];

      for (const candidate of confirmCandidates) {
        if (await candidate.count()) {
          await candidate.first().click({ timeout: 5000 }).catch(() => undefined);
          break;
        }
      }

      await page.waitForTimeout(5000);
    }

    fs.mkdirSync(path.dirname(options.screenshotPath), { recursive: true });
    await page.screenshot({
      path: options.screenshotPath,
      fullPage: true,
    });

    process.stdout.write(
      JSON.stringify(
        {
          url: page.url(),
          title: await page.title(),
          screenshot: options.screenshotPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
