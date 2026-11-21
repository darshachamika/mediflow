import assert from "node:assert/strict";
import { capture } from "./suwadora-capture.mjs";

export async function verifyStaffQueue(page, apiUrl) {
  const region = page.getByRole("region", { name: "Today’s OPD queue", exact: true });
  await region.getByLabel("Queue status counts").waitFor();
  const date = page.getByLabel("Queue date");
  const today = await date.inputValue();
  const previous = (offset) => {
    const day = new Date(today + "T12:00:00Z");
    day.setUTCDate(day.getUTCDate() - offset);
    return day.toISOString().slice(0, 10);
  };
  const rows = page.locator("tbody tr");
  await page.getByLabel("Status", { exact: true }).selectOption("Waiting");
  await page.getByLabel("Token number", { exact: true }).fill("999999");
  await page.getByText("No tokens match the current search and status filter.", { exact: true }).waitFor();
  await page.getByLabel("Token number", { exact: true }).fill("");
  await page.getByLabel("Status", { exact: true }).selectOption("All");
  await date.fill(previous(1));
  await page.getByRole("heading", { name: `OPD queue for ${previous(1)}`, exact: true }).waitFor();
  await rows.filter({ hasText: "Called" }).waitFor();
  assert.equal(await rows.count(), 2);
  assert.deepEqual(await rows.locator("td:first-child").allTextContents(), ["1", "2"]);
  assert.equal(await page.getByRole("button", { name: "Call next", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: /^Complete token/ }).count(), 0);
  await capture(page, "staff-populated-history");
  await date.fill(previous(2));
  await page.getByText("No tokens booked for this date.", { exact: true }).waitFor();
  assert.equal(await rows.count(), 0);
  const counts = page.getByLabel("Queue status counts");
  assert((await counts.locator("dd").allTextContents()).every((value) => value === "0"));
  await page.getByText("No tokens called for this date.", { exact: true }).waitFor();
  await capture(page, "staff-empty-history");

  // Hold a prior-date response while changing the date. Its eventual arrival must not restore old rows.
  let release;
  let intercepted;
  const arrived = new Promise((resolve) => { intercepted = resolve; });
  const hold = new Promise((resolve) => { release = resolve; });
  const pattern = `${apiUrl}/api/opd/queue?date=${previous(1)}`;
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    intercepted();
    await hold;
    await route.fulfill({ response }).catch(() => {});
  });
  await date.fill(previous(1));
  await arrived;
  await page.getByText("Loading queue…", { exact: true }).waitFor();
  await date.fill(previous(2));
  await page.getByText("No tokens booked for this date.", { exact: true }).waitFor();
  release();
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("heading", { name: "Today’s OPD queue", exact: true }).waitFor();
  await rows.first().waitFor();
  await page.getByLabel("Status", { exact: true }).selectOption("Completed");
  const refreshed = page.waitForResponse((response) => response.url() === `${apiUrl}/api/opd/queue?date=${today}` && response.ok());
  await refreshed;
  assert.equal(await page.getByLabel("Status", { exact: true }).inputValue(), "Completed");
  assert((await rows.locator("td:nth-child(2)").allTextContents()).every((value) => value === "Completed"));
  await capture(page, "staff-today");
  console.log("PASS staff browser: exact search and status filtering, full counts, ordered and empty history, stale-date response isolation, read-only past and Today polling");
}
