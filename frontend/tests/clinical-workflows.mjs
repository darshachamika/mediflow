import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { capture, checkMobile } from "./suwadora-capture.mjs";
import { verifyStaffQueue } from "./staff-release.mjs";

const [origin, apiUrl, password] = process.argv.slice(2);
assert(origin && apiUrl && password, "Run this test through Test-OpdV1.ps1 -ClinicalBrowserTest.");
const browser = await chromium.launch({ channel: "chrome" });
const clinical = `${apiUrl}/api/clinical`;
const note = "Private consultation note for the browser fixture.";
const summary = "Follow the synthetic care plan discussed today.";
const testName = "Browser fixture lab panel";
const result = "Browser fixture result: within synthetic reference range.";

async function signIn(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();
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
  await openPatientScreen(page, "My Visits");
  const view = page.getByRole("region", { name: "My Visits", exact: true });
  const refresh = view.getByRole("button", { name: "Refresh My Visits", exact: true });
  const ready = refresh.and(page.locator("button:enabled"));
  await ready.waitFor();
  const [visits, lab, appointments] = await Promise.all([
    ...["visits", "lab", "appointments"].map((resource) =>
      page.waitForResponse((response) => response.url() === `${clinical}/me/${resource}`
        && response.request().method() === "GET")),
    refresh.click(),
  ]);
  const responses = [visits, lab, appointments];
  for (const response of responses) assert(response.ok(), `GET ${response.url()} returned ${response.status()}`);
  await ready.waitFor();
  return { view, records: await Promise.all(responses.map((response) => response.json())) };
}

function openPatientScreen(page, name) {
  return page.getByRole("navigation", { name: "Patient portal", exact: true })
    .getByRole("link", { name, exact: true }).click();
}

async function openPatientLab(page) {
  await openPatientScreen(page, "Lab results");
  const view = page.getByRole("region", { name: "Lab Results", exact: true });
  await view.waitFor();
  return view;
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
  const secondPatient = await signIn("patient-b@example.test");
  const waiting = await book(secondPatient);
  await reception.getByLabel("Token number", { exact: true }).fill(String(waiting.tokenNumber));
  await reception.getByRole("button", { name: "Find token" }).click();
  await reception.getByRole("button", { name: "Check in token" }).click();
  await reception.getByText(`Token ${waiting.tokenNumber} · Waiting`, { exact: true }).waitFor();
  await doctor.getByRole("button", { name: "Refresh room", exact: true }).click();
  const rail = doctor.getByRole("region", { name: "Waiting queue", exact: true });
  await rail.getByText(`A-${String(waiting.tokenNumber).padStart(3, "0")}`, { exact: true }).waitFor();
  await doctor.getByText(`Token ${booked.tokenNumber} · In consultation`, { exact: true }).waitFor();
  await capture(doctor, "03-doctor-workspace", { fullPage: true });
  await lab.getByRole("button", { name: "Refresh worklist" }).click();
  const task = lab.getByRole("listitem").filter({ has: lab.getByRole("heading", { name: testName, exact: true }) });
  await task.getByLabel("Lab result").fill(result);
  await task.getByRole("button", { name: "Save lab result", exact: true }).click();
  await task.getByText(result, { exact: true }).waitFor();
  await capture(lab, "lab-staff-worklist");
  const enteredOnly = await refreshPatient(patient);
  assert(!enteredOnly.records[1].some((item) => item.test === testName), "An entered, unverified result must stay private.");
  assert.equal(await (await openPatientLab(patient)).getByText(result, { exact: true }).count(), 0);
  await task.getByRole("button", { name: "Verify lab result", exact: true }).click();
  await lab.getByText(`Result verified for ${testName}. The treating doctor can now publish it.`, { exact: true }).waitFor();
  await task.waitFor({ state: "hidden" });
  await lab.context().close();
  await reception.context().close();
  const verifiedOnly = await refreshPatient(patient);
  assert(!verifiedOnly.records[1].some((item) => item.test === testName));
  assert.equal(await (await openPatientLab(patient)).getByText(result, { exact: true }).count(), 0);

  await doctor.getByRole("button", { name: "Complete consultation", exact: true }).click();
  await doctor.getByText(`Completed consultation for token ${booked.tokenNumber}.`, { exact: true }).waitFor();
  const completedDraft = await refreshPatient(patient);
  assert(!completedDraft.records[0].some((item) => item.visitId === booked.id), "Completing a visit must not publish its draft.");
  assert.equal(await completedDraft.view.getByText(summary, { exact: true }).count(), 0);
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
  await capture(doctor, "detail-doctor-follow-up", { fullPage: true });

  const published = await refreshPatient(patient);
  await published.view.getByText(summary, { exact: true }).waitFor();
  assert.equal(await published.view.getByText(note, { exact: true }).count(), 0);
  assert(published.records[0].some((item) => item.visitId === booked.id && item.summary === summary && !("notes" in item)));
  assert(published.records[2].some((item) => Date.parse(item.startsAt) === startsAt.getTime()));
  await capture(patient, "06-my-visits");
  const labResults = await openPatientLab(patient);
  await capture(patient, "07-lab-results");
  await labResults.getByLabel("Test type").selectOption(testName);
  await labResults.locator("summary").filter({ hasText: testName }).click();
  await labResults.getByText(result, { exact: true }).waitFor();
  await capture(patient, "detail-lab-result");
  await openPatientScreen(patient, "Appointments");
  const appointments = patient.getByRole("region", { name: "Appointments", exact: true });
  await appointments.getByText("Next follow-up", { exact: true }).waitFor();
  const visibleTimes = await appointments.locator("time").evaluateAll((elements) => elements.map((item) => item.dateTime));
  assert(visibleTimes.some((value) => Date.parse(value) === startsAt.getTime()));
  await capture(patient, "08-appointments");
  console.log("PASS clinical browser: assigned consultation, validation, draft privacy, lab verification without visibility, publication, and Colombo appointment");

  const isolated = await refreshPatient(secondPatient);
  assert(!isolated.records[0].some((item) => item.visitId === booked.id));
  assert(!isolated.records[1].some((item) => item.test === testName));
  assert(!isolated.records[2].some((item) => Date.parse(item.startsAt) === startsAt.getTime()));
  assert.equal(await isolated.view.getByText(summary, { exact: true }).count(), 0);
  assert.equal(await (await openPatientLab(secondPatient)).getByText(result, { exact: true }).count(), 0);
  await openPatientScreen(secondPatient, "My Visits");
  const authorization = await observeAuthorization(secondPatient, `${clinical}/me/visits`, "Refresh My Visits");
  await openPatientScreen(patient, "My Visits");
  const ownerAuthorization = await observeAuthorization(patient, `${clinical}/me/visits`, "Refresh My Visits");
  const ownerProfile = await patient.request.get(`${apiUrl}/api/me`, { headers: { Authorization: ownerAuthorization } });
  assert.equal(ownerProfile.status(), 200);
  const { id: ownerId } = await ownerProfile.json();
  const labResult = published.records[1].find((item) => item.test === testName && item.result === result);
  const appointment = published.records[2].find((item) => Date.parse(item.startsAt) === startsAt.getTime());
  assert(labResult && appointment, "The newly published result and appointment must have API identifiers.");
  for (const [resource, idField, id] of [
    ["visits", "visitId", booked.id],
    ["lab", "id", labResult.id],
    ["appointments", "id", appointment.id],
  ]) {
    const response = await secondPatient.request.get(`${clinical}/me/${resource}`, {
      headers: { Authorization: authorization },
      params: { patientId: ownerId, [idField]: id },
    });
    assert.equal(response.status(), 200);
    const records = await response.json();
    assert(Array.isArray(records) && !records.some((item) => item[idField] === id),
      `Patient B's direct ${resource} request must ignore another patient's identifiers.`);
  }
  assert.equal((await secondPatient.request.get(`${clinical}/visits/${booked.id}`, { headers: { Authorization: authorization } })).status(), 403);
  const otherDoctor = await signIn("doctor-b@example.test");
  const otherDoctorAuth = await observeAuthorization(otherDoctor, `${clinical}/visits`, "Refresh visits");
  assert.equal((await otherDoctor.request.get(`${clinical}/visits/${booked.id}`, { headers: { Authorization: otherDoctorAuth } })).status(), 404);
  assert.equal(await otherDoctor.getByLabel("Visit", { exact: true }).locator(`option[value="${booked.id}"]`).count(), 0);
  console.log("PASS clinical browser and direct API: second patient cannot read the summary, lab result or follow-up; other doctor cannot open the visit");

  await openPatientScreen(patient, "Notifications");
  const notifications = patient.getByRole("region", { name: "Notifications", exact: true });
  await notifications.getByRole("button", { name: "Refresh notifications", exact: true }).click();
  const calledNotice = notifications.getByRole("listitem").filter({
    hasText: `Token ${booked.tokenNumber} called`,
  });
  await calledNotice.getByText(/SMS simulated/).first().waitFor();
  console.log("PASS supporting browser: Patient sees the token-call notification and simulated SMS status");
  await capture(patient, "10-notifications");

  await openPatientScreen(patient, "FAQ assistant");
  const faq = patient.getByRole("region", { name: "OPD FAQ assistant", exact: true });
  await faq.getByLabel("Your question").fill("Can reception print a walk-in token without an account?");
  await faq.getByRole("button", { name: "Ask", exact: true }).click();
  await faq.getByText(/reception can issue a printed walk-in token/).waitFor();
  await faq.getByRole("listitem").filter({ hasText: "OPD walk-in tokens" }).waitFor();
  console.log("PASS supporting browser: Patient sees the FAQ answer and its source");
  await capture(patient, "11-faq-assistant");
  await checkMobile(patient, "patient", [
    ["My Visits", "My Visits", "my-visits"], ["Lab results", "Lab Results", "lab-results"],
    ["Appointments", "Appointments", "appointments"], ["Notifications", "Notifications", "notifications"],
    ["FAQ assistant", "OPD FAQ assistant", "faq-assistant"],
  ]);

  const admin = await signIn("admin@example.test");
  const administration = admin.getByRole("region", { name: "OPD administration", exact: true });
  await administration.getByRole("heading", { name: /^Queue counts \d{4}-\d{2}-\d{2}$/ }).waitFor();
  await administration.getByRole("listitem").filter({ hasText: "Room C" }).first().waitFor();
  await administration.getByText("New department", { exact: true }).click();
  await administration.getByLabel("Department name").fill("Browser fixture department");
  await administration.getByRole("button", { name: "Add department", exact: true }).click();
  await administration.getByRole("listitem").filter({ hasText: "Browser fixture department" }).waitFor();
  await administration.getByText("New department", { exact: true }).click();
  console.log("PASS supporting browser: OpdAdmin sees queue counts and rooms, and can add a department");
  await capture(admin, "09-opd-administration");
  const staff = await signIn("staff@example.test");
  await verifyStaffQueue(staff, apiUrl);
} finally {
  await browser.close();
}
