# MediFlow

Local development requires Node.js 20.9 or later, the .NET 10 SDK, and Docker with Compose. Run each section from the repository root in a separate PowerShell terminal.

## Frontend

```powershell
npm.cmd --prefix frontend install
npm.cmd --prefix frontend run dev
```

Open [the frontend](http://localhost:3000).

## API

```powershell
dotnet run --project backend/MediFlow.Api -- --urls http://localhost:5080
```

From another terminal, run `Invoke-RestMethod http://localhost:5080/health`. The endpoint returns HTTP 200 with `{"status":"ok"}` when the API is running.

## PostgreSQL

```powershell
docker compose up -d --wait postgres
docker compose ps
```

Connect to `127.0.0.1:5432` using database and user `mediflow` and password `mediflow_local_only`. These are local development placeholders. Run `docker compose down` to stop the database and retain its data.

## Build checks

```powershell
npm.cmd --prefix frontend run build
dotnet build backend/MediFlow.Api
```
