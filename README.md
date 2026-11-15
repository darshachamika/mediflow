# MediFlow

Local development requires Node.js 20.9 or later, the .NET 10 SDK, Docker with Compose, and either a Firebase project or the local Auth Emulator. Run commands from the repository root in PowerShell 7.

## Firebase

In the Firebase console, enable the Email/Password sign-in provider, register a web app, and create a test user under Authentication → Users. Copy the user's UID for provisioning. Use the same Firebase project for the frontend and API.

Copy the example file and fill in the public web app settings from Firebase.

```powershell
Copy-Item frontend/.env.example frontend/.env.local
```

Keep the Firebase Admin service account JSON outside the repository. Set its absolute path and your Firebase project ID in the API terminal.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\path\outside\the\repo\firebase-admin.json'
$env:Firebase__ProjectId = 'your-firebase-project-id'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
```

The API uses Application Default Credentials. The frontend origin defaults to `http://localhost:3000`. Set `Frontend__Origin` in the API terminal if you use a different origin.

## PostgreSQL and migrations

```powershell
docker compose up -d --wait postgres
$apiProject = 'backend/MediFlow.Api'
dotnet user-secrets set 'ConnectionStrings:MediFlow' 'Host=127.0.0.1;Port=5433;Database=mediflow;Username=mediflow;Password=mediflow_local_only' --project $apiProject
dotnet tool install --global dotnet-ef --version 10.0.8
dotnet ef database update --project $apiProject -- --environment Development
```

Install `dotnet-ef` once. After future model changes, generate a migration with `dotnet ef migrations add YourMigrationName --project $apiProject --output-dir Data/Migrations -- --environment Development`, review it, and run the update command again. The Compose password is a local development placeholder. Run `docker compose down` to stop PostgreSQL and retain its volume.

## Start and verify sign-in

Start the API in the terminal where you set its environment variables.

```powershell
dotnet run --project backend/MediFlow.Api -- --urls http://localhost:5080
```

Start the frontend in another terminal and open [MediFlow](http://localhost:3000).

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run dev
```

Check the public health endpoint and the two unauthorized requests.

```powershell
curl.exe -i http://localhost:5080/health
curl.exe -i http://localhost:5080/api/me
curl.exe -i -H 'Authorization: Bearer invalid-token' http://localhost:5080/api/me
```

Expect HTTP 200 for health and HTTP 401 for both profile requests. Sign in through the frontend with the Firebase test user before provisioning it. In the browser's Network tab, check that `GET /api/me` returns HTTP 403.

To provision that account, open a PostgreSQL shell.

```powershell
docker compose exec postgres psql -U mediflow -d mediflow
```

Replace the placeholder with the Firebase Authentication UID and run this SQL in `psql`.

```sql
INSERT INTO app_users (firebase_uid, role)
VALUES ('your-firebase-user-uid', 'Patient')
ON CONFLICT (firebase_uid) DO NOTHING;
```

Sign out and back in. Check that `GET /api/me` returns HTTP 200 with the account's own `id`, `firebaseUid`, and `role` of `Patient`. The database controls the role.

## Book an OPD token

Apply the latest migration, then sign in as a provisioned Patient and select **Book OPD token**. The page shows the assigned number and OPD date. If the request fails, select the same button to retry with the same key.

`POST /api/opd/bookings` takes a Firebase Bearer token and an `Idempotency-Key` header. It issues a **Booked** token. Repeat the same key as the same patient to retrieve the original token, even after the OPD date changes. Token numbers start at 1 each day in Asia/Colombo.

### Reception check-in

Provision a separate Firebase UID in `app_users` with role `Reception`. Patients can give reception their token number or request an opaque check-in code using `POST /api/opd/bookings/{id}/check-in-code`. The code is the QR payload, expires after 15 minutes, and is replaced when a new code is issued.

- `GET /api/opd/reception/tokens/{number}` looks up a token for today.
- `POST /api/opd/reception/check-in` accepts JSON `{"tokenNumber":12}` or `{"code":"<QR payload>"}` and moves a Booked token to Waiting. A retry returns its original check-in result. An expired unused QR returns 410.
- `POST /api/opd/reception/walk-ins` requires an `Idempotency-Key` and returns a printable token number and OPD date. A walk-in enters Waiting directly.

The migration leaves existing statuses and histories intact. Legacy Waiting tokens receive a synthetic entry time at the start of their Colombo service date, ordered by token number.

## Test the OPD staff queue

Create a separate Email/Password account in the same Firebase project. After applying the latest EF migration, open `docker compose exec postgres psql -U mediflow -d mediflow` and provision the account using its Firebase Authentication UID.

```sql
INSERT INTO app_users (firebase_uid, role)
VALUES ('your-staff-firebase-uid', 'OpdStaff');
```

1. Sign in as a Patient and book two tokens. Check that both appear in the Patient view.
2. Check in both tokens through the Reception API. Sign in as OPD staff and confirm the tokens appear as **Waiting**.
3. Select **Call next**. Check that the lowest waiting token becomes **Called**, shows a Colombo call time, and appears as the last called token.
4. Continue until every token is called, then select **Call next** again. The page should report that no tokens are waiting.
5. In the browser Network tab, replay a successful call with the same Bearer token and `Idempotency-Key`. The response should match the original and the queue should stay unchanged.

Staff routes are `GET /api/opd/queue` and `POST /api/opd/queue/call-next`. A call requires an `Idempotency-Key` and returns `{ "empty": true, "token": null }` when the queue has no waiting tokens. The API remembers empty results too. Use a new key for each new action.

### Doctor rooms and public display

Assign a `Doctor` profile to an active room for the Colombo service date. One room and one doctor can appear only once in a daily assignment. Assigned doctors use `POST /api/opd/rooms/{roomId}/call-next` with an `Idempotency-Key`. A room can hold one active call or consultation at a time. The queue is ordered by check-in time, then token number.

Use `POST /api/opd/rooms/{roomId}/tokens/{bookingId}/{action}` with `start`, `complete`, `no-show`, or `requeue`. A requeue places the token at the back using its new queue entry time. Existing OpdStaff actions remain available for unassigned calls. Only the assigned doctor can change a room consultation.

`GET /api/opd/display` is the public reconnect snapshot. It exposes active token numbers and room names. The SignalR hub at `/hubs/opd` broadcasts the same shape as `DisplayUpdated`. Authenticated clients can invoke `Subscribe` for their authorized `TokenUpdated` or `QueueUpdated` events.

### Clinical records and follow-ups

Doctors may read or edit records for visits assigned to them at consultation start or after completion. Save notes and a separate patient summary through `PUT /api/clinical/visits/{visitId}/note` with `notes` and `summary`. Publish the summary after completing the visit with `POST /api/clinical/visits/{visitId}/publish`. Published notes are locked against edits.

The assigned doctor requests a lab test using `POST /api/clinical/visits/{visitId}/lab` with `test`. A `LabStaff` user reads `GET /api/clinical/lab/worklist`, enters `result` with `PUT /api/clinical/lab/{id}/result`, and verifies it with `POST /api/clinical/lab/{id}/verify`. The assigned doctor publishes the verified result with `POST /api/clinical/lab/{id}/publish`.

Doctors create slots with `POST /api/clinical/slots` using a future ISO timestamp with an offset in `startsAt` and a positive `capacity`. To book a follow-up, use `POST /api/clinical/visits/{visitId}/follow-up/{slotId}`. Patients read their own published visit summaries, published lab results, and appointments at `GET /api/clinical/me/visits`, `GET /api/clinical/me/lab`, and `GET /api/clinical/me/appointments`.

### Operations and notifications

Provision an `OpdAdmin` profile to list or create departments, rooms, and daily doctor assignments under `/api/opd/admin`. Create a department with `{"name":"General OPD"}`, a room with `{"name":"Room 1","departmentId":1}`, and an assignment with `{"roomId":1,"doctorId":2,"opdDate":"YYYY-MM-DD"}`. `GET /api/opd/admin/counts` returns counts for today's queue. Room and doctor overlaps for the same date return 409. Successful changes are audited. The role has no clinical access.

Patient calls and follow-up bookings write an outbox entry in the same database transaction. The worker makes delivered entries available at `GET /api/opd/notifications` for the owning patient. Appointment reminders become due 24 hours before the slot, or immediately for a closer slot. Every SMS in this implementation is simulated and recorded without a phone number or a provider call.

### Approximate wait estimate

`GET /api/opd/bookings/{id}/eta` estimates the wait for the owning patient's current Waiting token. It uses the check-in order, active assigned rooms, occupied rooms, and recent completed consultation durations. Configure the fallback with `OpdEta__FallbackMinutes` (default 12). With no serving rooms the estimate is unavailable. Check-in and walk-in issuance record feature snapshots for later evaluation. Consultation start time provides the eventual outcome.

## Build checks

```powershell
npm.cmd --prefix frontend run build
dotnet build backend/MediFlow.Api
```

If Next.js reports that the native Windows SWC binding is unavailable, append `-- --webpack` to the frontend dev or build command.

## OPD v1 verification

With Docker running, install the Firebase CLI and EF CLI if needed. The integration script uses free loopback ports for Firebase Auth Emulator, the API, and disposable PostgreSQL. It removes the test container when finished. The Compose database and its volume are untouched. pgAdmin can connect to the normal local database at the configured host and port.

```powershell
npm.cmd install --global firebase-tools
dotnet tool install --global dotnet-ef --version 10.0.8
pwsh -NoProfile -File scripts/Test-OpdV1.ps1
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -Upgrade
```

The suite checks server-side roles and ownership, booking replay and concurrent allocation, queue position, Call next replay and ordering, completion replay and timestamps, cancellation racing Call next, and both history response contracts. Patient history returns `{ opdDate, items }`. Staff history returns an array with `X-Opd-Date`. Dates use Asia/Colombo.

For browser verification, use the same fixture in a PowerShell terminal. Port 3097 must be available. The script prints the test dates and the credentials for its disposable emulator accounts.

```powershell
npm.cmd --prefix frontend ci
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -Browser
```

1. Open `http://localhost:3097` as `patient-a@example.test`. Select the populated history date and confirm only token 1 appears. Select the empty date and confirm the empty message. Select **Today** and confirm token rows return and requests resume every 10 seconds while visible.
2. Book two tokens, note the token numbers, and cancel the higher Waiting token. Open a separate browser session as `staff@example.test`. Select **Call next** until staff calls the lower token, then select **Complete** for that token. Confirm the Patient view shows both changes after polling.
3. In the staff view, select the populated date and verify token order, then select the empty date and verify four zero counts. Return to **Today** and verify the live queue. Sign in separately as `patient-b@example.test` and verify only that patient's history is visible.
4. Press Enter in the fixture terminal to clean up. Rebuild the frontend with its normal Firebase configuration before starting a production build from the same directory.
