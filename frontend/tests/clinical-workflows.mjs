import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const [origin, apiUrl, password] = process.argv.slice(2);
assert(origin && apiUrl && password, "Run this test through Test-OpdV1.ps1 -ClinicalBrowserTest.");
const browser = await chromium.launch({ channel: "chrome" });
const clinical = `${apiUrl}/api/clinical`;
const note = "Private consultation note for the browser fixture.";
const summary = "Follow the synthetic care plan discussed today.";
const testName = "Browser fixture lab panel";
const result = "Browser fixture result: within synthetic reference range.";

async function signIn(email) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(origin);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText(`Signed in as ${email}`, { exact: true }).waitFor();
  return page;
}

async function observeAuthorization(page, path, refreshButton) {
  const [request] = await Promise.all([
    page.waitForRequest((request) => request.method() === "GET" && request.url() === path),
    page.getByRole("button", { name: refreshButton, exact: true }).click(),
  ]);
  const authorization = await request.headerValue("authorization");
  assert(authorization, "Browser requests must include Firebase authentication.");
  return authorization;
}

async function book(patient) {
  const pending = patient.waitForResponse((response) =>
    response.url() === `${apiUrl}/api/opd/bookings` && response.request().method() === "POST" && response.ok());
  await patient.getByRole("button", { name: "Book OPD token", exact: true }).click();
  return (await pending).json();
}

async function refreshPatient(page) {
  const requests = ["visits", "lab", "appointments"].map((resource) =>
    page.waitForResponse((response) => response.url() === `${clinical}/me/${resource}` && response.ok()));
  const view = page.getByRole("region", { name: "My Visits", exact: true });
  await view.getByRole("button", { name: "Refresh My Visits", exact: true }).click();
  const responses = await Promise.all(requests);
  await view.getByRole("button", { name: "Refresh My Visits", exact: true }).waitFor();
  return { view, records: await Promise.all(responses.map((response) => response.json())) };
}

try {
  const patient = await signIn("patient-a@example.test");
  const reception = await signIn("reception@example.test");
  const doctor = await signIn("doctor-a@example.test");
  const lab = await signIn("lab@example.test");
  const booked = await book(patient);
  await reception.getByLabel("Token number", { exact: true }).fill(String(booked.tokenNumber));
  await reception.getByRole("button", { name: "Find token" }).click();
  await reception.getByRole("button", { name: "Check in token" }).click();
  await reception.getByText(`Token ${booked.tokenNumber} · Waiting`, { exact: true }).waitFor();
  await doctor.getByRole("button", { name: "Call next in room" }).click();
  await doctor.getByText(`Token ${booked.tokenNumber} · Called`, { exact: true }).waitFor();
  await doctor.getByRole("button", { name: "Start consultation" }).click();
  await doctor.getByRole("button", { name: "Open consultation" }).click();
  const chart = doctor.getByRole("region", { name: `Visit for token ${booked.tokenNumber}`, exact: true });
  await chart.getByLabel("Private visit notes").fill("   ");
  await chart.getByRole("button", { name: "Save visit draft" }).click();
  await chart.getByText("Enter the private visit notes before saving.", { exact: true }).waitFor();
  await chart.getByLabel("Private visit notes").fill(note);
  await chart.getByLabel("Patient-facing summary").fill(summary);
  await chart.getByRole("button", { name: "Save visit draft" }).click();
  await chart.getByText("Visit draft saved.", { exact: true }).waitFor();
  await chart.getByText("Complete the consultation before publishing the summary.", { exact: true }).waitFor();
  const draft = await refreshPatient(patient);
  assert(!draft.records[0].some((item) => item.visitId === booked.id));
  assert.equal(await draft.view.getByText(summary, { exact: true }).count(), 0);

  await chart.getByLabel("Test name").fill(testName);
  await chart.getByRole("button", { name: "Request lab test" }).click();
  await chart.getByText(`${testName} · Requested`, { exact: true }).waitFor();
  await lab.getByRole("button", { name: "Refresh worklist" }).click();
  const task = lab.getByRole("listitem").filter({ has: lab.getByRole("heading", { name: testName, exact: true }) });
  await task.getByLabel("Lab result").fill(result);
  await task.getByRole("button", { name: "Save lab result", exact: true }).click();
  await task.getByText(result, { exact: true }).waitFor();
  await task.getByRole("button", { name: "Verify lab result", exact: true }).click();
  await lab.getByText(`Result verified for ${testName}. The treating doctor can now publish it.`, { exact: true }).waitFor();
  await task.waitFor({ state: "hidden" });
  await lab.context().close();
  await reception.context().close();
  const verifiedOnly = await refreshPatient(patient);
  assert(!verifiedOnly.records[1].some((item) => item.test === testName));
  assert.equal(await verifiedOnly.view.getByText(result, { exact: true }).count(), 0);

  await doctor.getByRole("button", { name: "Complete consultation", exact: true }).click();
  await chart.getByRole("button", { name: "Publish visit summary", exact: true }).click();
  await chart.getByText("Visit summary published.", { exact: true }).waitFor();
  await chart.getByRole("button", { name: "Refresh visit", exact: true }).click();
  await chart.getByRole("button", { name: `Publish result for ${testName}`, exact: true }).click();
  await chart.getByText("Lab result published.", { exact: true }).waitFor();

  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 4);
  startsAt.setUTCSeconds(0, 0);
  const colomboDateTime = new Date(startsAt.getTime() + 330 * 60_000).toISOString().slice(0, 16);
  await chart.getByLabel("Sri Lanka appointment date and time").fill(colomboDateTime);
  await chart.getByLabel("Slot capacity").fill("2");
  await chart.getByRole("button", { name: "Schedule follow-up", exact: true }).click();
  await chart.getByText(/Follow-up scheduled for/).waitFor();

  const published = await refreshPatient(patient);
  await published.view.getByText(summary, { exact: true }).waitFor();
  await published.view.getByText(result, { exact: true }).waitFor();
  assert.equal(await published.view.getByText(note, { exact: true }).count(), 0);
  assert(published.records[0].some((item) => item.visitId === booked.id && item.summary === summary && !("notes" in item)));
  assert(published.records[2].some((item) => Date.parse(item.startsAt) === startsAt.getTime()));
  const visibleTimes = await published.view.locator("time").evaluateAll((elements) => elements.map((item) => item.dateTime));
  assert(visibleTimes.some((value) => Date.parse(value) === startsAt.getTime()));
  console.log("PASS clinical browser: assigned consultation, validation, draft privacy, lab verification without visibility, publication, and Colombo appointment");

  const secondPatient = await signIn("patient-b@example.test");
  const isolated = await refreshPatient(secondPatient);
  assert(!isolated.records[0].some((item) => item.visitId === booked.id));
  assert(!isolated.records[1].some((item) => item.test === testName));
  assert(!isolated.records[2].some((item) => Date.parse(item.startsAt) === startsAt.getTime()));
  assert.equal(await isolated.view.getByText(summary, { exact: true }).count(), 0);
  assert.equal(await isolated.view.getByText(result, { exact: true }).count(), 0);
  const authorization = await observeAuthorization(secondPatient, `${clinical}/me/visits`, "Refresh My Visits");
  assert.equal((await secondPatient.request.get(`${clinical}/visits/${booked.id}`, { headers: { Authorization: authorization } })).status(), 403);
  const otherDoctor = await signIn("doctor-b@example.test");
  const otherDoctorAuth = await observeAuthorization(otherDoctor, `${clinical}/visits`, "Refresh visits");
  assert.equal((await otherDoctor.request.get(`${clinical}/visits/${booked.id}`, { headers: { Authorization: otherDoctorAuth } })).status(), 404);
  assert.equal(await otherDoctor.getByLabel("Visit", { exact: true }).locator(`option[value="${booked.id}"]`).count(), 0);
  console.log("PASS clinical browser: second patient cannot read the summary, lab result or follow-up; other doctor cannot open the visit");
} finally {
  await browser.close();
}
