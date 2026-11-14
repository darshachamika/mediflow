# MediFlow

Local development requires Node.js 20.9 or later, the .NET 10 SDK, Docker with Compose, and a Firebase project. Run commands from the repository root in PowerShell.

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
dotnet user-secrets set 'ConnectionStrings:MediFlow' 'Host=127.0.0.1;Port=5432;Database=mediflow;Username=mediflow;Password=mediflow_local_only' --project $apiProject
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

`POST /api/opd/bookings` takes a Firebase Bearer token and an `Idempotency-Key` header. A successful request returns HTTP 200 with `id`, `opdDate`, and `tokenNumber`. Repeat the same key as the same patient to retrieve the original booking, even after the OPD date changes. Each new key creates a booking. Token numbers start at 1 each day in Asia/Colombo.

## Test the OPD staff queue

Create a separate Email/Password account in the same Firebase project. After applying the latest EF migration, open `docker compose exec postgres psql -U mediflow -d mediflow` and provision the account using its Firebase Authentication UID.

```sql
INSERT INTO app_users (firebase_uid, role)
VALUES ('your-staff-firebase-uid', 'OpdStaff');
```

1. Sign in as a Patient and book two tokens. Check that both appear in the Patient view.
2. Sign out and sign in with the staff account. Check that today's queue is sorted by token number and shows the tokens as **Waiting**.
3. Select **Call next**. Check that the lowest waiting token becomes **Called**, shows a Colombo call time, and appears as the last called token.
4. Continue until every token is called, then select **Call next** again. The page should report that no tokens are waiting.
5. In the browser Network tab, replay a successful call with the same Bearer token and `Idempotency-Key`. The response should match the original and the queue should stay unchanged.

Staff routes are `GET /api/opd/queue` and `POST /api/opd/queue/call-next`. A call requires an `Idempotency-Key` and returns `{ "empty": true, "token": null }` when the queue has no waiting tokens. The API remembers empty results too. Use a new key for each new action.

## Build checks

```powershell
npm.cmd --prefix frontend run build
dotnet build backend/MediFlow.Api
```

If Next.js reports that the native Windows SWC binding is unavailable, append `-- --webpack` to the frontend dev or build command.
