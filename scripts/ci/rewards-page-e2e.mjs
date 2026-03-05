#!/usr/bin/env node

import { chromium } from "playwright";

const baseUrlRaw = process.env.E2E_BASE_URL?.trim();

if (!baseUrlRaw) {
  console.error("[rewards-e2e] Missing E2E_BASE_URL");
  process.exit(1);
}

const rewardsUrl = new URL("/rewards", baseUrlRaw).toString();
const runtimeErrorPattern = /(uncaught|typeerror|referenceerror|cannot read|split of undefined)/i;

function fail(message, details) {
  console.error(`[rewards-e2e] ${message}`);
  if (details !== undefined) {
    try {
      console.error(JSON.stringify(details, null, 2));
    } catch {
      console.error(String(details));
    }
  }
  process.exit(1);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const pageErrors = [];
  const runtimeConsoleErrors = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (runtimeErrorPattern.test(text)) {
        runtimeConsoleErrors.push(text);
      }
    }
  });

  const response = await page.goto(rewardsUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (!response) {
    await browser.close();
    fail("navigation failed (no response)");
  }

  if (response.status() >= 500) {
    await browser.close();
    fail("navigation failed with 5xx", { status: response.status(), url: response.url() });
  }

  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch {
    // Keep this best-effort; some hosts keep long-lived requests.
  }

  await page.waitForTimeout(1000);

  const bodyText = ((await page.locator("body").innerText()) ?? "").toLowerCase();

  const redErrorBlocks = await page.$$eval(
    '[class*="border-red"][class*="bg-red"]',
    (nodes) => nodes.map((node) => (node.textContent ?? "").trim()).filter(Boolean),
  );
  const rewardsErrorBlocks = redErrorBlocks.filter((text) => /error|not_found/i.test(text));

  await browser.close();

  if (bodyText.includes("not_found")) {
    fail("found not_found on /rewards page");
  }

  if (bodyText.includes("something went wrong")) {
    fail("AppErrorBoundary fallback rendered on /rewards page");
  }

  if (pageErrors.length > 0) {
    fail("uncaught runtime errors detected via pageerror", pageErrors);
  }

  if (runtimeConsoleErrors.length > 0) {
    fail("runtime-related console errors detected", runtimeConsoleErrors);
  }

  if (rewardsErrorBlocks.length > 0) {
    fail("red error blocks detected on /rewards page", rewardsErrorBlocks);
  }

  console.log("[rewards-e2e] PASS /rewards page has no not_found, no red error, no uncaught runtime error");
}

run().catch((error) => {
  fail("unexpected failure", {
    name: error?.name,
    message: error?.message,
    stack: error?.stack,
  });
});
