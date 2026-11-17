import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const directory = process.env.MEDIFLOW_SCREENSHOT_DIRECTORY;

export async function capture(page, name, { fullPage = false } = {}) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  const viewport = page.viewportSize();
  if (fullPage) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: viewport.width, height });
  }
  try {
    await page.screenshot({ path: join(directory, `${name}.png`), animations: "disabled" });
  } finally {
    if (fullPage) await page.setViewportSize(viewport);
  }
}

export async function checkMobile(page, prefix, screens) {
  if (!directory) return;
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    for (const [link, heading, name] of screens) {
      if (link) await page.getByRole("navigation", { name: "Patient portal", exact: true })
        .getByRole("link", { name: link, exact: true }).click();
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${heading} overflows a 390px viewport.`);
      await capture(page, `mobile-${prefix}-${name}`);
    }
  } finally {
    await page.setViewportSize(desktop);
  }
}
