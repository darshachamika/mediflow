import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { capture, checkMobile } from "./suwadora-capture.mjs";

const [origin, apiUrl, password, populatedDate, emptyDate] = process.argv.slice(2);
assert(origin && apiUrl && password && populatedDate && emptyDate, "Run this test through Test-OpdV1.ps1 -BrowserTest.");
const browser = await chromium.launch({ channel: "chrome" });
const timeout = 20_000;

async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await page.goto(origin);
  if (email === "patient-a@example.test") {
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await capture(page, "05-sign-in");
    await checkMobile(page, "patient", [[null, "Sign in", "sign-in"]]);
  }
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
  const display = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
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
  await capture(patient, "01-patient-portal");
  await checkMobile(patient, "patient", [[null, "My OPD visit", "portal"]]);
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
  const shared = reception.getByRole("region", { name: "Shared queue", exact: true });
  await shared.getByText("Walk-in", { exact: false }).waitFor();
  await shared.getByText("Online", { exact: false }).first().waitFor();
  await capture(reception, "02-reception-desk");
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
  assert(await display.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await capture(display, "04-waiting-hall-1920x1080");
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

  const scan = await book(patient);
  const scanImage = await scan.qr.getAttribute("src");
  await reception.bringToFront();
  await reception.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    const frames = { denied: true, stream: null, constraints: null, showCode: false };
    window.fixtureCamera = frames;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (frames.denied) throw new DOMException("Consent declined", "NotAllowedError");
      frames.constraints = constraints;
      const stream = canvas.captureStream(15);
      frames.stream = stream;
      const timer = setInterval(() => {
        if (!stream.active) return clearInterval(timer);
        context.fillStyle = "white";
        context.fillRect(0, 0, 640, 480);
        if (frames.showCode) context.drawImage(image, 140, 60, 360, 360);
      }, 65);
      return stream;
    };
  }, scanImage);
  const startCamera = reception.getByRole("button", { name: "Start camera", exact: true });
  const confirm = reception.getByRole("button", { name: "Check in by QR", exact: true });
  await startCamera.click();
  await reception.getByText(/Camera permission denied/).waitFor();
  assert(await confirm.isDisabled());

  await reception.evaluate(() => { window.fixtureCamera.denied = false; });
  await startCamera.click();
  await reception.getByText(/Center the patient's QR code/).waitFor();
  await reception.getByText(/No readable SuwaDora check-in QR yet/).waitFor({ timeout: 15_000 });
  assert(await confirm.isDisabled());
  await reception.getByRole("navigation", { name: "Reception desk" }).getByRole("link", { name: "Find token" }).click();
  assert(await reception.evaluate(() => !window.fixtureCamera.stream.active));

  let checkIns = 0;
  const scanEndpoint = `${apiUrl}/api/opd/reception/check-in`;
  reception.on("request", (request) => {
    if (request.method() === "POST" && request.url() === scanEndpoint) checkIns++;
  });
  await startCamera.click();
  await reception.getByText(/Center the patient's QR code/).waitFor();
  await reception.evaluate(() => { window.fixtureCamera.showCode = true; });
  await reception.getByText("QR read. Select Check in by QR to confirm.", { exact: true }).waitFor();
  assert.equal(checkIns, 0, "A camera read must wait for staff confirmation");
  assert(await reception.evaluate(() => !window.fixtureCamera.stream.active));
  assert.equal(await reception.evaluate(() => window.fixtureCamera.constraints.video.facingMode.ideal), "environment");
  await confirm.click();
  await reception.getByText(`Token ${scan.tokenNumber} checked in.`, { exact: true }).waitFor();
  assert.equal(checkIns, 1);
  await patient.bringToFront();
  await tokenStatus(patient, scan.tokenNumber, "Waiting");
  await patient.getByRole("button", { name: `Cancel token ${scan.tokenNumber}`, exact: true }).click();
  await tokenStatus(patient, scan.tokenNumber, "Cancelled");
  console.log("PASS browser: simulated live camera, permission denial, unreadable frames, cleanup, explicit confirmation and fresh QR check-in");
} finally {
  await browser.close();
}
