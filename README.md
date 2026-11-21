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

For a pgAdmin-managed instance, use the server's actual host, port, database and role in the same User Secrets command. Apply migrations with the same EF command. In pgAdmin's Query Tool, check the migration history with `SELECT "MigrationId" FROM "__EFMigrationsHistory" ORDER BY "MigrationId";`.

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

### Browser OPD workflow

Patients book from the home page and receive a check-in QR for today's Booked token. They can regenerate it from the token list or give reception their token number. Reception can select **Start camera**, allow camera permission, and scan a fresh QR. A successful read stops the camera and populates the code for **Check in by QR** confirmation. Image upload, a scanner that types a payload, and manual token lookup are also supported. Camera access needs HTTPS or localhost. **Issue walk-in token** creates a printable ticket with its token number and date.

Doctors see their assigned room for today's Colombo date after sign-in. Use **Call next in room**, **Start consultation**, and **Complete consultation** in order. The legacy OpdStaff queue remains available for unassigned calls. The public display at `/display` needs no sign-in. It uses SignalR and gets a fresh snapshot after reconnecting. The Patient date picker shows the completed token in booking history.

### Reception API

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
3. Select **Call next**. Check that the first token in check-in order becomes **Called**, shows a Colombo call time, and appears as the last called token.
4. Continue until every token is called, then select **Call next** again. The page should report that no tokens are waiting.
5. In the browser Network tab, replay a successful call with the same Bearer token and `Idempotency-Key`. The response should match the original and the queue should stay unchanged.

Staff routes are `GET /api/opd/queue` and `POST /api/opd/queue/call-next`. A call requires an `Idempotency-Key` and returns `{ "empty": true, "token": null }` when the queue has no waiting tokens. The API remembers empty results too. Use a new key for each new action.

### Doctor rooms and public display

Assign a `Doctor` profile to an active room for the Colombo service date. One room and one doctor can appear only once in a daily assignment. Assigned doctors use `POST /api/opd/rooms/{roomId}/call-next` with an `Idempotency-Key`. A room can hold one active call or consultation at a time. The queue is ordered by check-in time, then token number.

Use `POST /api/opd/rooms/{roomId}/tokens/{bookingId}/{action}` with `start`, `complete`, `no-show`, or `requeue`. A requeue places the token at the back using its new queue entry time. Existing OpdStaff actions remain available for unassigned calls. Only the assigned doctor can change a room consultation.

`GET /api/opd/display` is the public reconnect snapshot. It exposes active token numbers and room names. Doctors can recover their active token with `GET /api/opd/rooms/{roomId}`. The SignalR hub at `/hubs/opd` broadcasts the public snapshot as `DisplayUpdated`. Authenticated clients can invoke `Subscribe` for their authorized `TokenUpdated` or `QueueUpdated` events.

### Clinical records and follow-ups

Doctors may read or edit records for visits assigned to them at consultation start or after completion. Save notes and a separate patient summary through `PUT /api/clinical/visits/{visitId}/note` with `notes` and `summary`. Publish the summary after completing the visit with `POST /api/clinical/visits/{visitId}/publish`. Published notes are locked against edits.

The assigned doctor requests a lab test using `POST /api/clinical/visits/{visitId}/lab` with `test`. A `LabStaff` user reads `GET /api/clinical/lab/worklist`, enters `result` with `PUT /api/clinical/lab/{id}/result`, and verifies it with `POST /api/clinical/lab/{id}/verify`. The assigned doctor publishes the verified result with `POST /api/clinical/lab/{id}/publish`.

Doctors create slots with `POST /api/clinical/slots` using a future ISO timestamp with an offset in `startsAt` and a positive `capacity`. To book a follow-up, use `POST /api/clinical/visits/{visitId}/follow-up/{slotId}`. Patients read their own published visit summaries, published lab results, and appointments at `GET /api/clinical/me/visits`, `GET /api/clinical/me/lab`, and `GET /api/clinical/me/appointments`.

#### Clinical browser demo

Run the automated OPD and clinical checks together on the disposable PostgreSQL and Firebase fixtures.

```powershell
Set-Location D:\Mad\mediflow
npm.cmd --prefix frontend ci
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -BrowserTest -ClinicalBrowserTest
```

For a manual walkthrough, run `pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -Browser` and open `http://localhost:3097` in separate browser sessions for each role. Use the emulator password printed by the fixture.

1. As `patient-a@example.test`, book a token. As `reception@example.test`, check in that token.
2. As `doctor-a@example.test`, call the token, start the consultation, and select **Open consultation**. Save private notes and a patient-facing summary. Request a synthetic lab test.
3. As `lab@example.test`, refresh the worklist, enter a synthetic result, and verify it. Confirm that the result is still absent from the patient's **My Visits**.
4. As the doctor, complete the consultation and publish the summary. Select **Refresh visit** before publishing the verified result. Schedule a follow-up using a future Sri Lanka date and time.
5. Refresh **My Visits** as Patient A and confirm the published summary is visible. Select **Lab results** to open the published result and **Appointments** for the follow-up. Sign in as `patient-b@example.test` and confirm Patient A's records are absent. The OPD date picker remains under **My OPD visit**.

### Operations and notifications

Provision an `OpdAdmin` profile to list or create departments, rooms, and daily doctor assignments under `/api/opd/admin`. Create a department with `{"name":"General OPD"}`, a room with `{"name":"Room 1","departmentId":1}`, and an assignment with `{"roomId":1,"doctorId":2,"opdDate":"YYYY-MM-DD"}`. `GET /api/opd/admin/counts` returns counts for today's queue. Room and doctor overlaps for the same date return 409. Successful changes are audited. The role has no clinical access.

Patient calls and follow-up bookings write an outbox entry in the same database transaction. The worker makes delivered entries available at `GET /api/opd/notifications` for the owning patient. Appointment reminders become due 24 hours before the slot, or immediately for a closer slot. Every SMS in this implementation is simulated and recorded without a phone number or a provider call.

### Approximate wait estimate

`GET /api/opd/bookings/{id}/eta` estimates the wait for the owning patient's current Waiting token. It uses the check-in order, active assigned rooms, occupied rooms, and recent completed consultation durations. Configure the fallback with `OpdEta__FallbackMinutes` (default 12). With no serving rooms the estimate is unavailable. Check-in and walk-in issuance record feature snapshots for later evaluation. The first call time provides the eventual outcome.

### Read-only FAQ assistant

`POST /api/opd/assistant/query` accepts a Patient Bearer token and JSON with `kind` set to `faq`, `tokens`, or `appointments`. For FAQ mode supply a general OPD `question`. Answers cite synthetic demo guides. Use reception for unsupported questions and keep personal information out of FAQ prompts. The personal modes return the verified caller's structured records directly from the API without contacting the FAQ provider.

The default is a local, deterministic FAQ provider with keyword retrieval. For vector retrieval, install pgvector on the PostgreSQL instance, apply the EF migrations, and run `scripts/Enable-OpdFaqVector.sql` in pgAdmin Query Tool. Set `OpdFaq__VectorEnabled=true`, then as OpdAdmin call `POST /api/opd/admin/faq/index`. Reindex after changing the embedding model. For a configured HTTP provider, store `OpdFaq:ApiKey` in .NET User Secrets and set `OpdFaq__ProviderUrl`, `OpdFaq__EmbeddingModel`, and `OpdFaq__ChatModel` as applicable. The provider must support the OpenAI-compatible embeddings and chat-completions endpoints.

```powershell
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -Vector
```

### Waiting-time ML

```powershell
dotnet run --project tools/eta-ml-experiment -- --synthetic artifacts/eta/synthetic
```

The ML.NET SDCA regression predicts total minutes from queue entry to first call. It uses captured entry features of tokens ahead, serving rooms, busy rooms, recent consultation duration, and the exact existing baseline. The API subtracts elapsed waiting and caps the result with the current baseline so cancellations and extra serving rooms can reduce the remaining estimate. This conservative combination can underestimate long waits and requires operational evaluation before rollout.

Arrival time and weekday are omitted until representative data supports them. Completed-duration features use only outcomes already available at observation time. The existing schema is reused and no migration is needed. The ETA endpoint adds source (Baseline or Model) and modelVersion. Only today's Waiting tokens show an approximate wait.

The read-only export includes completed bookings with valid first calls, snapshots within five seconds of check-in, unchanged queue-entry timestamps, valid features, and no no-show or requeue events. Legacy bookings without samples are excluded. No identifiers, clinical text or credentials are exported. Export only databases with known provenance. CSV content cannot distinguish synthetic and operational records.

```powershell
Set-Location D:\Mad\mediflow
docker compose up -d --wait postgres
dotnet ef database update --project backend/MediFlow.Api -- --environment Development
pwsh -NoProfile -File scripts/Export-OpdEta.ps1 -Container mediflow-postgres-1 -Output artifacts/eta/operational/visits.csv
dotnet run --project tools/eta-ml-experiment -- --csv artifacts/eta/operational/visits.csv artifacts/eta/operational/candidate
Get-Content artifacts/eta/operational/candidate/metadata.json
```

Apply development database migrations when ready to upgrade it. The implementation audit found 19 legacy local bookings and no ETA sample table, leaving zero usable captured observations. Operational activation remains disabled. Synthetic metrics demonstrate pipeline behavior only.

Training uses seed 2026, one worker and no shuffling. The chronological 80/20 split groups entire Asia/Colombo dates and excludes training outcomes unknown before evaluation. Identical inputs produce identical model bytes and metadata on the verified runtime. Metadata records feature schema, model version, artifact SHA-256, data kind, partition counts/date ranges, MAE/RMSE and acceptance status.

Initial activation gates require 100 training observations spanning at least 14 calendar dates, 30 evaluation observations spanning at least seven dates, at least 5% lower MAE and no worse RMSE than the baseline. These engineering gates were chosen for this milestone. Review provenance, representative coverage and errors for your OPD before rollout, and retain an untouched prospective dataset. The gates alone do not establish operational validity.

After reviewing an operational candidate, explicitly set its directory and enable it, then restart the API. Firebase and PostgreSQL setup use the existing sections above.

```powershell
dotnet user-secrets set 'OpdEta:ModelDirectory' (Resolve-Path artifacts/eta/operational/candidate).Path --project backend/MediFlow.Api
dotnet user-secrets set 'OpdEta:ModelEnabled' 'true' --project backend/MediFlow.Api
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --project backend/MediFlow.Api --no-launch-profile --urls http://localhost:5080
# In a second terminal with frontend Firebase configuration ready
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend run start
```

Rollback disables the model and restarts the API. A missing, corrupt, incompatible, unaccepted or synthetic operational artifact falls back automatically. Startup logs report model readiness. Invalid predictions fall back and no serving rooms means unavailable. The model is immutable until restart and predictions are synchronized for concurrency.

```powershell
dotnet user-secrets set 'OpdEta:ModelEnabled' 'false' --project backend/MediFlow.Api
```

Synthetic verification uses disposable PostgreSQL and Firebase Auth Emulator. Generated artifacts and exports stay beneath the Git-ignored artifacts/eta directory.

```powershell
dotnet run --project tools/eta-ml-experiment -- --synthetic artifacts/eta/synthetic
dotnet run --project tools/eta-ml-experiment -- --synthetic artifacts/eta/repeated
if ((Get-Content artifacts/eta/synthetic/metadata.json -Raw) -cne (Get-Content artifacts/eta/repeated/metadata.json -Raw)) { throw 'Training is not reproducible' }
dotnet run --project tools/eta-ml-experiment -- --self-test
dotnet build backend/MediFlow.Api
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -MlTest
$env:MEDIFLOW_SCREENSHOT_DIRECTORY = Join-Path $env:TEMP 'mediflow-eta-browser'
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -BrowserTest -ClinicalBrowserTest
# Optional interactive browser demo with synthetic inference
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -MlTest -Browser
git diff --check
```

Synthetic model loading requires Development plus explicit OpdEta:AllowSyntheticModel=true. The -MlTest fixture sets and restores its environment automatically. Keep this flag disabled for ordinary development. In the demo, book as patient-a@example.test, check in as reception@example.test, return to the patient tab and confirm Approximate wait appears after refresh. Cancel or call an earlier token and confirm the count and estimate update. Called, completed, cancelled and historical tokens have no waiting estimate. Patient B cannot request Patient A's ETA.

### C++ queue simulator

With CMake and a C++17 compiler available in PowerShell:

```powershell
cmake -S tools/queue-simulator -B tools/queue-simulator/obj/cmake
cmake --build tools/queue-simulator/obj/cmake --config Release
ctest --test-dir tools/queue-simulator/obj/cmake -C Release --output-on-failure
& (Get-ChildItem tools/queue-simulator/obj/cmake -Recurse -Filter queue-simulator.exe | Select-Object -First 1).FullName
```

The CLI uses one fixed synthetic arrival and consultation sequence for both room counts. It reports the median and nearest-rank 90th percentile of waiting time. Its deterministic test checks each wait against a hand-calculated FIFO scenario.

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

The server suite checks roles, ownership, booking and reception, queue position and ETA, concurrent room claims, SignalR permissions and public payloads, consultation and lab publication, appointment capacity, outbox delivery, admin conflicts and both history formats. Patient history returns `{ opdDate, items }`. Staff history returns an array with `X-Opd-Date`. Dates use Asia/Colombo. The upgrade run seeds a legacy Waiting booking before applying the new migrations and checks that it survives.

The optional vector run uses `pgvector/pgvector:pg17` with the local test provider. If you have a trusted PostgreSQL 17 pgvector Debian package matching the architecture and Debian release of your `postgres:17` image, pass its local path with `-Vector -VectorPackage 'C:\path\to\postgresql-17-pgvector.deb'`. The script installs it only in the disposable test container.

For the PostgreSQL 17.11 Debian 13 amd64 image, the PGDG 0.8.6 package is an alternative to pulling the vector image.

```powershell
$package = Join-Path $env:TEMP 'mediflow-pgvector-pg17.deb'
curl.exe --fail --location 'https://apt.postgresql.org/pub/repos/apt/pool/main/p/pgvector/postgresql-17-pgvector_0.8.6-1.pgdg13%2B2_amd64.deb' --output $package
if ($LASTEXITCODE -ne 0) { throw 'pgvector download failed' }
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -Upgrade -Vector -VectorPackage $package
```

For automated browser verification, install Google Chrome and run the fixture with `-BrowserTest`. It uses a separate Chrome instance, disposable accounts, and a free local port.

```powershell
npm.cmd --prefix frontend ci
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -BrowserTest
```

The test uploads the generated QR image into Reception, checks in the patient, issues a walk-in, calls and completes both tokens in the same assigned room, and forces a SignalR reconnection. It checks the print layout and print-button invocation without opening a printer dialog.

For manual browser verification, run the same fixture with `-Browser` in PowerShell. Port 3097 must be free. The fixture runs the server assertions and prints the test dates and credentials for the disposable emulator accounts.

```powershell
npm.cmd --prefix frontend ci
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -Browser
```

1. Open `http://localhost:3097` as `patient-a@example.test`. Select the populated history date and confirm only token 1 appears. Select the empty date and confirm the empty message. Select **Today** and confirm token rows return and requests resume every 10 seconds while visible.
2. Book two tokens and note their numbers. In a second PowerShell terminal, sign in to the fixture's Auth Emulator as reception and check in both tokens. Use the emulator URL, API URL, and password printed by the fixture.

```powershell
$auth = Read-Host 'Fixture Auth Emulator URL'
$api = Read-Host 'Fixture API URL'
$password = Read-Host 'Fixture password'
$signIn = @{ email = 'reception@example.test'; password = $password; returnSecureToken = $true } | ConvertTo-Json
$session = Invoke-RestMethod "$auth/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo" -Method Post -ContentType 'application/json' -Body $signIn
$headers = @{ Authorization = "Bearer $($session.idToken)" }
foreach ($number in @([int](Read-Host 'Lower token number'), [int](Read-Host 'Higher token number'))) {
    Invoke-RestMethod "$api/api/opd/reception/check-in" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ tokenNumber = $number } | ConvertTo-Json)
}
```

Cancel the higher Waiting token in the Patient view. Open a separate browser session as `staff@example.test`. Select **Call next**, then **Complete** for the lower token. Confirm the Patient view shows both changes after polling.
3. In the staff view, select the populated date and verify token order, then select the empty date and verify four zero counts. Return to **Today** and verify the live queue. Sign in separately as `patient-b@example.test` and verify only that patient's history is visible.
4. Press Enter in the fixture terminal to clean up. Rebuild the frontend with its normal Firebase configuration before starting a production build from the same directory.

## v1 handover

The supported v1 scope covers Firebase/profile authorization, patient booking and cancellation, reception check-in and walk-ins, shared queues, assigned-room consultations, publication-controlled clinical records, follow-ups, operations, notifications, sourced FAQ, history, public SignalR display and guarded waiting-time ML. The API enforces role and ownership boundaries. Daily token allocation and state transitions use PostgreSQL transactions and constraints.

### Accounts and provisioning

The disposable browser fixture creates the following synthetic accounts. All use password `mediflow-emulator-only`. Use separate browser profiles or Incognito windows for different roles.

| Account | Role |
| --- | --- |
| patient-a@example.test, patient-b@example.test | Patient |
| reception@example.test | Reception |
| doctor-a@example.test, doctor-b@example.test | Doctor |
| staff@example.test | OpdStaff |
| lab@example.test | LabStaff |
| admin@example.test | OpdAdmin |

For your own Firebase project, create separate Email/Password accounts and provision their actual Firebase UIDs in PostgreSQL. Use the following template once per account, substituting its UID and one role from the table. Doctor room assignments use the resulting numeric app-user ID and today's Asia/Colombo date. Provision an OpdAdmin account first, then use its Administration screen to create rooms and assignments.

```sql
INSERT INTO app_users (firebase_uid, role)
VALUES ('replace-with-firebase-uid', 'Doctor')
ON CONFLICT (firebase_uid) DO NOTHING;
SELECT id, role FROM app_users WHERE firebase_uid = 'replace-with-firebase-uid';
```

### Verified setup and review

Install .NET 10 SDK, Node.js 20.9+, PowerShell 7, Docker Desktop, and Google Chrome. Start Docker Desktop before running these commands. The fixture sets up its own PostgreSQL database, applies migrations, starts Firebase Auth Emulator, and provisions synthetic accounts. Live Firebase credentials are unnecessary for the fixture.

```powershell
Set-Location D:\Mad\mediflow
npm.cmd --prefix frontend ci
npm.cmd install --global firebase-tools
# Install once if dotnet-ef is missing
dotnet tool install --global dotnet-ef --version 10.0.8
dotnet build backend/MediFlow.Api
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -MlTest
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -BrowserTest -ClinicalBrowserTest
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -Upgrade
git diff --check
# Start a baseline demo, then open http://localhost:3097
pwsh -NoProfile -File scripts/Test-OpdV1.ps1 -Browser
```

The browser fixture runs the Next.js production build with isolated fixture output and a copied TypeScript configuration. Every API fixture also uses a unique build configuration. This allows verification beside an existing preview without overwriting its binaries or assets. Generated files remain ignored. Automated fixtures use free frontend ports. The interactive fixture uses port 3097, which must be free. It prints its API and Auth Emulator URLs and test dates. Press Enter in its terminal to stop its processes and disposable container. Stop the normal development database with `docker compose down` to retain bookings. Use Ctrl+C to stop normal frontend/API terminals.

### Manual hardware acceptance

1. On the reception device, use localhost or an HTTPS address. As Patient A, generate a fresh QR. As Reception, select Start camera, allow access and scan it from the patient's screen. Check that the video stops and the code fills before staff confirmation. Confirm once and check that the patient becomes Waiting.
2. Deny permission and verify the upload/manual alternatives. Try a damaged image. Generate a replacement QR and verify the earlier code is rejected. Test an unused QR after its 15-minute expiry. Stop the scanner, switch tabs, navigate away and sign out, confirming the device camera indicator switches off each time.
3. Issue a walk-in token, select Print token and check the actual paper output contains the correct number/date and excludes the surrounding workstation UI. Automated tests cover QR image decoding, a simulated video stream, print invocation and print CSS. Physical camera and printer acceptance remains pending.

### Release limits and deployment preparation

- The UI uses the supplied reference compositions with recreated artwork and synthetic records in captures. Decorative borders and exact data-dependent spacing differ from the mockups. Language switching, settings, Remember me, password reset and patient self-booking of follow-ups are omitted because these controls have no implemented flows.
- SMS delivery is simulated. A real provider, consent/contact-data design and delivery monitoring are required before sending messages externally.
- FAQ defaults to deterministic sourced demo guides. A configured HTTP provider must support both embeddings and chat completions. A locally stored Gemini key alone does not verify provider/model compatibility. Validate that integration separately with general service questions and no patient information.
- Operational ML remains disabled until representative real observations satisfy the documented activation gates and operational review. Synthetic results validate the pipeline only. The baseline cap can underestimate longer waits.
- Before a real patient deployment, configure production Firebase and HTTPS hosting, secret storage, database backups and a tested restore procedure, monitoring, access review, and retention/audit requirements appropriate to the deployment. This repository has no verified production deployment or backup/restore automation. Arrange a clinical/privacy review for real records.
- If NuGet reports NU1900, compilation may still pass while the vulnerability feed is unavailable. Complete dependency vulnerability review from an environment with registry access before deployment.

The development database audit found 19 bookings and no captured ETA sample table. It was inspected read-only and retained. Apply existing migrations deliberately when upgrading that database. Schema upgrades are tested using a disposable legacy database.
