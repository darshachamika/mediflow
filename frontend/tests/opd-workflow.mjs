import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const [origin, apiUrl, password, populatedDate, emptyDate] = process.argv.slice(2);
assert(origin && apiUrl && password && populatedDate && emptyDate, "Run this test through Test-OpdV1.ps1 -BrowserTest.");
const browser = await chromium.launch({ channel: "chrome" });
const timeout = 20_000;

async function signIn(email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText(`Signed in as ${email}`, { exact: true }).waitFor();
  return page;
}

async function book(patient) {
  const booked = patient.waitForResponse((response) =>
    response.url() === `${apiUrl}/api/opd/bookings` && response.request().method() === "POST" && response.ok());
  await patient.getByRole("button", { name: "Book OPD token", exact: true }).click();
  const { tokenNumber } = await (await booked).json();
  const qr = patient.getByRole("img", { name: `Check-in QR for token ${tokenNumber}` });
  await qr.waitFor();
  await tokenStatus(patient, tokenNumber, "Booked");
  return { tokenNumber, qr };
}

function queueRows(patient) {
  return patient.locator("section[aria-labelledby='today-tokens']").getByRole("listitem");
}

function tokenStatus(patient, number, status) {
  return queueRows(patient).filter({
    hasText: new RegExp(`^Token ${number} for .* · ${status}(?:\\s|$)`),
  }).waitFor({ timeout });
}

function displayRow(display, number) {
  return display.getByRole("row").filter({ has: display.getByRole("cell", { name: String(number), exact: true }) });
}

function assertPublic(items) {
  assert(Array.isArray(items));
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ["room", "tokenNumber"]);
    assert(Number.isInteger(item.tokenNumber));
    assert.equal(typeof item.room, "string");
  }
}

try {
  const patient = await signIn("patient-a@example.test");
  const reception = await signIn("reception@example.test");
  const doctor = await signIn("doctor-a@example.test");
  await doctor.getByRole("heading", { name: "Room A" }).waitFor();
  const display = await (await browser.newContext()).newPage();
  let displaySocket;
  let blockReconnect = false;
  const publicEvents = [];
  await display.routeWebSocket(/\/hubs\/opd$/, (socket) => {
    if (blockReconnect) {
      socket.close({ code: 1012, reason: "Test disconnect" });
      return;
    }
    displaySocket = socket;
    const server = socket.connectToServer();
    server.onMessage((message) => {
      for (const frame of String(message).split("\x1e").filter(Boolean)) {
        const event = JSON.parse(frame);
        if (event.target === "DisplayUpdated") publicEvents.push(event.arguments[0]);
      }
      socket.send(message);
    });
  });
  await display.goto(`${origin}/display`);
  await display.getByText("Live", { exact: true }).waitFor();
  await display.getByText("No tokens are currently called.", { exact: true }).waitFor();

  const online = await book(patient);
  const image = await online.qr.getAttribute("src");
  assert.match(image, /^data:image\/png;base64,/);
  await reception.getByLabel("Upload QR image").setInputFiles({
    name: "patient-check-in.png", mimeType: "image/png", buffer: Buffer.from(image.split(",")[1], "base64"),
  });
  await reception.getByText("QR read. Select Check in by QR to confirm.", { exact: true }).waitFor();
  await reception.getByRole("button", { name: "Check in by QR", exact: true }).click();
  await reception.getByText(`Token ${online.tokenNumber} checked in.`, { exact: true }).waitFor();
  await patient.bringToFront();
  await tokenStatus(patient, online.tokenNumber, "Waiting");
  await online.qr.waitFor({ state: "hidden" });

  const walkInResponse = reception.waitForResponse((response) =>
    response.url() === `${apiUrl}/api/opd/reception/walk-ins` && response.ok());
  await reception.getByRole("button", { name: "Issue walk-in token" }).click();
  const { tokenNumber: walkIn } = await (await walkInResponse).json();
  assert.equal(walkIn, online.tokenNumber + 1);
  const ticket = reception.getByRole("region", { name: "Walk-in ticket" });
  await ticket.getByText(`Token ${walkIn}`, { exact: true }).waitFor();
  await reception.evaluate(() => { window.print = () => { document.body.dataset.printRequested = "yes"; }; });
  await reception.getByRole("button", { name: "Print token" }).click();
  assert.equal(await reception.locator("body").getAttribute("data-print-requested"), "yes");
  await reception.emulateMedia({ media: "print" });
  assert.equal(await ticket.evaluate((element) => getComputedStyle(element).visibility), "visible");
  assert.equal(await reception.getByRole("heading", { name: "OPD reception", includeHidden: true }).evaluate(
    (element) => getComputedStyle(element).visibility), "hidden");
  await reception.emulateMedia({ media: "screen" });
  console.log("PASS browser: online booking, generated and decoded QR image, check-in status, printable walk-in ticket");

  await doctor.getByRole("button", { name: "Call next in room" }).click();
  await doctor.getByText(`Token ${online.tokenNumber} · Called`, { exact: true }).waitFor();
  await displayRow(display, online.tokenNumber).getByRole("cell", { name: "Room A" }).waitFor();
  assert(publicEvents.some((items) => items.some((item) => item.tokenNumber === online.tokenNumber)));
  for (const event of publicEvents) assertPublic(event);
  assert.deepEqual(await display.getByRole("columnheader").allTextContents(), ["Token number", "Room"]);
  await doctor.getByRole("button", { name: "Start consultation" }).click();
  await doctor.getByText(`Token ${online.tokenNumber} · In consultation`, { exact: true }).waitFor();
  await doctor.getByRole("button", { name: "Complete consultation" }).click();
  await doctor.getByText(`Completed consultation for token ${online.tokenNumber}.`, { exact: true }).waitFor();
  await displayRow(display, online.tokenNumber).waitFor({ state: "hidden" });

  blockReconnect = true;
  displaySocket.close({ code: 1012, reason: "Test disconnect" });
  await display.getByText("Reconnecting…", { exact: true }).waitFor();
  await doctor.getByRole("button", { name: "Call next in room" }).click();
  await doctor.getByText(`Token ${walkIn} · Called`, { exact: true }).waitFor();
  const snapshot = display.waitForResponse((response) => response.url() === `${apiUrl}/api/opd/display` && response.ok());
  blockReconnect = false;
  const items = await (await snapshot).json();
  assertPublic(items);
  assert.deepEqual(items, [{ tokenNumber: walkIn, room: "Room A" }]);
  await displayRow(display, walkIn).getByRole("cell", { name: "Room A" }).waitFor();
  await doctor.getByRole("button", { name: "Start consultation" }).click();
  await doctor.getByText(`Token ${walkIn} · In consultation`, { exact: true }).waitFor();
  await doctor.getByRole("button", { name: "Complete consultation" }).click();
  await doctor.getByText(`Completed consultation for token ${walkIn}.`, { exact: true }).waitFor();
  await displayRow(display, walkIn).waitFor({ state: "hidden" });
  console.log("PASS browser: FIFO room calls, both consultations, SignalR-only update, reconnect snapshot, public fields limited to number and room");

  await patient.bringToFront();
  const date = patient.getByLabel("Queue date");
  await date.fill(populatedDate);
  await queueRows(patient).filter({ hasText: `Token 1 for ${populatedDate}` }).waitFor();
  assert.equal(await queueRows(patient).count(), 1);
  await date.fill(emptyDate);
  await patient.getByText("You have no OPD tokens for this date.", { exact: true }).waitFor();
  await patient.getByRole("button", { name: "Today", exact: true }).click();
  await tokenStatus(patient, online.tokenNumber, "Completed");
  assert.equal(await queueRows(patient).filter({ hasText: new RegExp(`^Token ${walkIn} for `) }).count(), 0);
  const manual = await book(patient);
  await reception.getByLabel("Token number", { exact: true }).fill(String(manual.tokenNumber));
  await reception.getByRole("button", { name: "Find token" }).click();
  await reception.getByText(`Token ${manual.tokenNumber} · Booked`).waitFor();
  await reception.getByRole("button", { name: "Check in token", exact: true }).click();
  await reception.getByText(`Token ${manual.tokenNumber} · Waiting`, { exact: true }).waitFor();
  await patient.bringToFront();
  await tokenStatus(patient, manual.tokenNumber, "Waiting");
  await patient.getByRole("button", { name: `Cancel token ${manual.tokenNumber}`, exact: true }).click();
  await tokenStatus(patient, manual.tokenNumber, "Cancelled");
  console.log("PASS browser: populated and empty patient history, Completed on Today, walk-in isolation, manual lookup and check-in");
} finally {
  await browser.close();
}
