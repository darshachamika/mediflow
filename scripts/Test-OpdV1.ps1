param([switch]$Browser)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path "$PSScriptRoot/..").Path
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$container = "mediflow-v1-$runId"
$scratch = Join-Path $root "backend/MediFlow.Api/obj/$container"
$apiProject = Join-Path $root 'backend/MediFlow.Api'
$apiUrl = 'http://127.0.0.1:5093'
$authUrl = 'http://127.0.0.1:9198'
$frontendOrigin = 'http://localhost:3097'
$emulatorProject = 'demo-mediflow'
$password = 'mediflow-emulator-only'
$environmentNames = @('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'FIREBASE_AUTH_EMULATOR_HOST',
    'Firebase__ProjectId', 'GOOGLE_APPLICATION_CREDENTIALS', 'ConnectionStrings__MediFlow', 'Frontend__Origin',
    'NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL')
$savedEnvironment = @{}
foreach ($key in $environmentNames) { $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key) }

function Assert($condition, [string]$description) {
    if (!$condition) { throw $description }
}

function Wait-Http([string]$uri, $process) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($process.HasExited) { throw "Process exited before $uri became available. See $scratch." }
        try {
            $null = Invoke-WebRequest $uri -TimeoutSec 2 -SkipHttpErrorCheck
            return
        } catch { Start-Sleep -Seconds 1 }
    }
    throw "Timed out waiting for $uri. See $scratch."
}

function Send([string]$method, [string]$route, [string]$token = '', [string]$key = '') {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), "$apiUrl$route")
    if ($token) { $request.Headers.Add('Authorization', "Bearer $token") }
    if ($key) { $request.Headers.Add('Idempotency-Key', $key) }
    $request.Headers.Add('Origin', $frontendOrigin)
    $client.SendAsync($request)
}

function Read-Response($task, [int]$expected = 200) {
    $response = $task.GetAwaiter().GetResult()
    try {
        Assert ([int]$response.StatusCode -eq $expected) "Expected HTTP $expected, got $([int]$response.StatusCode) for $($response.RequestMessage.RequestUri.AbsolutePath)."
        if ($expected -eq 200) {
            $raw = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            [pscustomobject]@{ Raw = $raw; Body = (ConvertFrom-Json -InputObject $raw -NoEnumerate); Headers = $response.Headers.ToString() }
        }
    } finally { $response.Dispose() }
}

try {
    New-Item -ItemType Directory -Path $scratch -Force | Out-Null
    $firebaseCommand = Get-Command firebase.cmd
    $firebaseJs = Join-Path (Split-Path $firebaseCommand.Source) 'node_modules/firebase-tools/lib/bin/firebase.js'
    Assert (Test-Path -LiteralPath $firebaseJs) 'Install Firebase CLI with npm.cmd install -g firebase-tools.'
    '{"emulators":{"auth":{"host":"127.0.0.1","port":9198},"ui":{"enabled":false},"hub":{"port":4498},"logging":{"port":4598}}}' |
        Set-Content "$scratch/firebase.json"
    '{"type":"authorized_user","client_id":"demo","client_secret":"demo","refresh_token":"demo"}' |
        Set-Content "$scratch/credentials.json"
    $emulator = Start-Process node -ArgumentList ('"' + $firebaseJs + '" emulators:start --only auth --project ' + $emulatorProject + ' --config firebase.json') `
        -WorkingDirectory $scratch -WindowStyle Hidden -PassThru -RedirectStandardOutput "$scratch/firebase.out" -RedirectStandardError "$scratch/firebase.err"

    docker run -d --rm --name $container -e POSTGRES_PASSWORD=disposable -p 127.0.0.1::5432 postgres:17 | Out-Null
    Assert ($LASTEXITCODE -eq 0) 'Could not start disposable PostgreSQL.'
    $databaseStarted = $true
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker exec $container pg_isready -h 127.0.0.1 -U postgres | Out-Null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 1
    }
    Assert ($LASTEXITCODE -eq 0) 'Disposable PostgreSQL did not become ready.'
    $port = ((docker port $container 5432/tcp) -split ':')[-1]
    $env:ConnectionStrings__MediFlow = "Host=127.0.0.1;Port=$port;Database=postgres;Username=postgres;Password=disposable"
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:DOTNET_ENVIRONMENT = 'Development'
    $env:Firebase__ProjectId = $emulatorProject
    $env:FIREBASE_AUTH_EMULATOR_HOST = ([uri]$authUrl).Authority
    $env:GOOGLE_APPLICATION_CREDENTIALS = "$scratch/credentials.json"
    $env:Frontend__Origin = $frontendOrigin

    dotnet build $apiProject -c Release --nologo
    Assert ($LASTEXITCODE -eq 0) 'API build failed.'
    dotnet ef database update --no-build --configuration Release --project $apiProject
    Assert ($LASTEXITCODE -eq 0) 'Fresh database migration failed.'
    Wait-Http $authUrl $emulator
    $accounts = foreach ($name in 'patient-a', 'patient-b', 'staff', 'unprovisioned') {
        $body = @{ email = "$name@example.test"; password = $password; returnSecureToken = $true } | ConvertTo-Json
        Invoke-RestMethod "$authUrl/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo" -Method Post -ContentType 'application/json' -Body $body
    }
    $patientA, $patientB, $staff, $unknown = $accounts.idToken
    @"
INSERT INTO app_users(firebase_uid,role) VALUES
('$($accounts[0].localId)','Patient'),('$($accounts[1].localId)','Patient'),('$($accounts[2].localId)','OpdStaff');
INSERT INTO opd_bookings(patient_id,idempotency_key,opd_date,token_number,status,called_at)
VALUES (1,'history-a',(now() AT TIME ZONE 'Asia/Colombo')::date-1,1,'Called',now()-interval '1 day'),
       (2,'history-b',(now() AT TIME ZONE 'Asia/Colombo')::date-1,2,'Waiting',NULL);
"@ | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1
    Assert ($LASTEXITCODE -eq 0) 'Test data setup failed.'

    $api = Start-Process dotnet -ArgumentList 'bin/Release/net10.0/MediFlow.Api.dll','--urls',$apiUrl `
        -WorkingDirectory $apiProject -WindowStyle Hidden -PassThru -RedirectStandardOutput "$scratch/api.out" -RedirectStandardError "$scratch/api.err"
    Wait-Http "$apiUrl/health" $api
    $client = [System.Net.Http.HttpClient]::new()
    $bookings = '/api/opd/bookings'
    $queue = '/api/opd/queue'
    $callNext = "$queue/call-next"
    $today = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow,'Asia/Colombo').Date
    $current = $today.ToString('yyyy-MM-dd')
    $past = $today.AddDays(-1).ToString('yyyy-MM-dd')
    $empty = $today.AddDays(-2).ToString('yyyy-MM-dd')
    $future = $today.AddDays(1).ToString('yyyy-MM-dd')

    Read-Response (Send GET '/api/me') 401
    Read-Response (Send GET '/api/me' 'invalid') 401
    Read-Response (Send GET '/api/me' $unknown) 403
    Assert ((Read-Response (Send GET '/api/me' $patientA)).Body.role -eq 'Patient') 'Patient profile role mismatch.'
    Assert ((Read-Response (Send GET '/api/me' $staff)).Body.role -eq 'OpdStaff') 'Staff profile role mismatch.'
    Read-Response (Send GET $bookings $staff) 403
    Read-Response (Send POST $bookings $staff 'denied') 403
    Read-Response (Send GET $queue $patientA) 403
    Read-Response (Send POST $callNext $patientA 'denied') 403
    Read-Response (Send GET $queue) 401
    Read-Response (Send POST $bookings) 401
    Read-Response (Send POST $bookings $patientA) 400
    Read-Response (Send POST $callNext $staff) 400
    foreach ($bad in '', '2026-02-30', '2026-1-02', $future) {
        Read-Response (Send GET "${bookings}?date=$bad" $patientA) 400
        Read-Response (Send GET "${queue}?date=$bad" $staff) 400
    }
    'PASS Firebase provisioning, invalid and anonymous authentication, roles and validation'

    $firstRequest = Send POST $bookings $patientA 'same-booking'
    $retryRequest = Send POST $bookings $patientA 'same-booking'
    $first = Read-Response $firstRequest
    Assert ((Read-Response $retryRequest).Raw -ceq $first.Raw) 'Concurrent booking replay changed the token.'
    $firstId = $first.Body.id
    $aRequest = Send POST $bookings $patientA 'distinct-a'
    $bRequest = Send POST $bookings $patientB 'distinct-b'
    $secondA = (Read-Response $aRequest).Body
    $secondB = (Read-Response $bRequest).Body
    $initial = (Read-Response (Send GET $queue $staff)).Body
    Assert (($initial.tokenNumber -join ',') -eq '1,2,3') 'Expected three unique sequential tokens.'
    Read-Response (Send POST "$bookings/$firstId/cancel" $patientB) 404
    Read-Response (Send POST "$queue/$firstId/complete" $staff) 409

    $cancel = Read-Response (Send POST "$bookings/$firstId/cancel" $patientA)
    Assert ($cancel.Body.status -eq 'Cancelled' -and (Read-Response (Send POST "$bookings/$firstId/cancel" $patientA)).Raw -ceq $cancel.Raw) 'Cancellation/replay mismatch.'
    $waiting = (Read-Response (Send GET $bookings $patientB)).Body
    Assert ($waiting.items.Count -eq 1 -and $waiting.items[0].id -eq $secondB.id -and
        $waiting.items[0].waitingAhead -eq ($secondB.tokenNumber - 2)) 'Ownership or waiting-ahead count mismatch.'

    $call = Send POST $callNext $staff 'same-call'
    $callRetry = Send POST $callNext $staff 'same-call'
    $called = Read-Response $call
    Assert ($called.Body.token.tokenNumber -eq 2 -and (Read-Response $callRetry).Raw -ceq $called.Raw) 'Call-next ordering, skip or replay failed.'
    $calledBooking = $initial | Where-Object tokenNumber -eq 2
    $calledOwner = if ($calledBooking.id -eq $secondA.id) { $patientA } else { $patientB }
    Read-Response (Send POST "$bookings/$($calledBooking.id)/cancel" $calledOwner) 409
    Read-Response (Send POST "$queue/$($calledBooking.id)/complete" $patientA) 403
    Read-Response (Send POST "$queue/$($calledBooking.id)/complete") 401
    $completion = Send POST "$queue/$($calledBooking.id)/complete" $staff
    $completionRetry = Send POST "$queue/$($calledBooking.id)/complete" $staff
    $done = Read-Response $completion
    Assert ($done.Body.status -eq 'Completed' -and $done.Body.completedAt -and (Read-Response $completionRetry).Raw -ceq $done.Raw) 'Completion replay changed the timestamp.'
    $own = (Read-Response (Send GET $bookings $calledOwner)).Body.items | Where-Object id -eq $calledBooking.id
    Assert ($own.status -eq 'Completed' -and $own.completedAt -eq $done.Body.completedAt) 'Patient did not see completion.'

    $remaining = $initial | Where-Object tokenNumber -eq 3
    $remainingOwner = if ($remaining.id -eq $secondA.id) { $patientA } else { $patientB }
    $cancelRace = Send POST "$bookings/$($remaining.id)/cancel" $remainingOwner
    $callRace = Send POST $callNext $staff 'race-call'
    $raceResult = (Read-Response $callRace).Body
    $raceStatus = if ($raceResult.empty) { 200 } else { 409 }
    $null = Read-Response $cancelRace $raceStatus
    $finalQueue = (Read-Response (Send GET $queue $staff)).Body
    $finalStatus = if ($raceResult.empty) { 'Cancelled' } else { 'Called' }
    Assert ($finalQueue[2].status -eq $finalStatus) 'Call/cancel race did not preserve a single transition.'
    Assert ((Read-Response (Send POST $callNext $staff 'empty-call')).Body.empty) 'Expected an empty call result.'
    "PASS booking, position, cancellation, ordered calling, completion and concurrent replay/race ($finalStatus)"

    foreach ($request in @(
        @{ Date = $current; Tokens = '1,' + $secondA.tokenNumber },
        @{ Date = $past; Tokens = '1' },
        @{ Date = $empty; Tokens = '' },
        @{ Date = $current; Tokens = '1,' + $secondA.tokenNumber }
    )) {
        $date = $request.Date
        $result = Read-Response (Send GET "${bookings}?date=$date" $patientA)
        Assert ($result.Body.opdDate -eq $date -and $result.Body.items -is [array] -and
            ($result.Body.items.tokenNumber -join ',') -eq $request.Tokens -and
            $result.Headers -match "X-Opd-Date: $date") "Patient date/shape mismatch for $date."
    }
    $other = (Read-Response (Send GET "${bookings}?date=$past" $patientB)).Body.items
    Assert ($other.Count -eq 1 -and $other[0].tokenNumber -eq 2) 'Historical ownership mismatch.'
    Read-Response (Send POST "$bookings/$($other[0].id)/cancel" $patientB) 404
    $history = Read-Response (Send GET "${queue}?date=$past" $staff)
    Assert (($history.Body.tokenNumber -join ',') -eq '1,2' -and $history.Headers -match "X-Opd-Date: $past") 'Staff history mismatch.'
    Assert ((Read-Response (Send GET "${queue}?date=$empty" $staff)).Raw -eq '[]') 'Staff empty history mismatch.'
    Read-Response (Send POST "$queue/$($history.Body[0].id)/complete" $staff) 404
    'PASS Patient and Staff populated and empty history, date contracts, read-only history and return to Today'

    if ($Browser) {
        $env:NEXT_PUBLIC_FIREBASE_API_KEY = 'demo-api-key'
        $env:NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'demo-mediflow.firebaseapp.com'
        $env:NEXT_PUBLIC_FIREBASE_PROJECT_ID = $emulatorProject
        $env:NEXT_PUBLIC_FIREBASE_APP_ID = '1:123:web:demo'
        $env:NEXT_PUBLIC_API_URL = $apiUrl
        $env:NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL = $authUrl
        $frontendDir = Join-Path $root 'frontend'
        npm.cmd --prefix $frontendDir run build
        Assert ($LASTEXITCODE -eq 0) 'Browser fixture frontend build failed.'
        $frontend = Start-Process node -ArgumentList 'node_modules/next/dist/bin/next','start','--port','3097' `
            -WorkingDirectory $frontendDir -WindowStyle Hidden -PassThru -RedirectStandardOutput "$scratch/frontend.out" -RedirectStandardError "$scratch/frontend.err"
        Wait-Http $frontendOrigin $frontend
        "Browser fixture ready at $frontendOrigin. Use patient-a@example.test, patient-b@example.test or staff@example.test with password $password."
        "Populated date $past. Empty date $empty. Press Enter to clean up."
        $null = Read-Host
    }
} finally {
    if ($client) { $client.Dispose() }
    foreach ($process in @($frontend, $api, $emulator)) {
        if ($process -and !$process.HasExited) { Stop-Process -InputObject $process }
    }
    if ($databaseStarted) { docker stop $container | Out-Null }
    foreach ($key in $environmentNames) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key]) }
}
