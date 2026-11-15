param([switch]$Browser, [switch]$Upgrade, [switch]$Vector)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path "$PSScriptRoot/..").Path
$runId = [guid]::NewGuid().ToString('N').Substring(0, 8)
$container = "mediflow-v1-$runId"
$scratch = Join-Path $root "backend/MediFlow.Api/obj/$container"
$apiProject = Join-Path $root 'backend/MediFlow.Api'
function Get-TestPorts {
    $listeners = foreach ($i in 1..4) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $listener
    }
    try { $listeners | ForEach-Object { $_.LocalEndpoint.Port } }
    finally { $listeners | ForEach-Object { $_.Stop() } }
}
$apiPort, $authPort, $hubPort, $logPort = Get-TestPorts
$apiUrl = "http://127.0.0.1:$apiPort"
$authUrl = "http://127.0.0.1:$authPort"
$frontendOrigin = 'http://localhost:3097'
$emulatorProject = 'demo-mediflow'
$password = 'mediflow-emulator-only'
$environmentNames = @('ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT', 'FIREBASE_AUTH_EMULATOR_HOST',
    'Firebase__ProjectId', 'GOOGLE_APPLICATION_CREDENTIALS', 'ConnectionStrings__MediFlow', 'Frontend__Origin',
    'NEXT_PUBLIC_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL',
    'OpdFaq__VectorEnabled', 'OpdFaq__ApiKey')
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

function Send([string]$method, [string]$route, [string]$token = '', [string]$key = '', $body = $null) {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), "$apiUrl$route")
    if ($token) { $request.Headers.Add('Authorization', "Bearer $token") }
    if ($key) { $request.Headers.Add('Idempotency-Key', $key) }
    if ($null -ne $body) {
        $request.Content = [System.Net.Http.StringContent]::new(($body | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
    }
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
    @{ emulators = @{ auth = @{ host = '127.0.0.1'; port = $authPort }; ui = @{ enabled = $false }; hub = @{ port = $hubPort }; logging = @{ port = $logPort } } } |
        ConvertTo-Json -Depth 5 |
        Set-Content "$scratch/firebase.json"
    '{"type":"authorized_user","client_id":"demo","client_secret":"demo","refresh_token":"demo"}' |
        Set-Content "$scratch/credentials.json"
    $emulator = Start-Process node -ArgumentList ('"' + $firebaseJs + '" emulators:start --only auth --project ' + $emulatorProject + ' --config firebase.json') `
        -WorkingDirectory $scratch -WindowStyle Hidden -PassThru -RedirectStandardOutput "$scratch/firebase.out" -RedirectStandardError "$scratch/firebase.err"

    $image = if ($Vector) { 'pgvector/pgvector:pg17' } else { 'postgres:17' }
    docker run -d --rm --name $container -e POSTGRES_PASSWORD=disposable -p 127.0.0.1::5432 $image | Out-Null
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
    $env:OpdFaq__VectorEnabled = $Vector.IsPresent.ToString()
    $env:OpdFaq__ApiKey = ' '

    dotnet build $apiProject -c Verification --nologo
    Assert ($LASTEXITCODE -eq 0) 'API build failed.'
    if ($Upgrade) {
        dotnet ef database update OpdTokenCompletion --no-build --configuration Verification --project $apiProject
        Assert ($LASTEXITCODE -eq 0) 'Baseline migration failed.'
        "INSERT INTO app_users(firebase_uid,role) VALUES ('legacy-fixture','Patient'); INSERT INTO opd_bookings(patient_id,idempotency_key,opd_date,token_number) VALUES (1,'legacy',(now() AT TIME ZONE 'Asia/Colombo')::date-10,12);" |
            docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1
        Assert ($LASTEXITCODE -eq 0) 'Baseline seeding failed.'
    }
    dotnet ef database update --no-build --configuration Verification --project $apiProject
    Assert ($LASTEXITCODE -eq 0) 'Fresh database migration failed.'
    if ($Vector) {
        Get-Content "$root/scripts/Enable-OpdFaqVector.sql" -Raw | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1
        Assert ($LASTEXITCODE -eq 0) 'Could not initialize pgvector.'
    }
    if ($Upgrade) {
        $preserved = docker exec $container psql -U postgres -tAc "SELECT count(*) FROM opd_bookings WHERE idempotency_key='legacy' AND token_number=12 AND status='Waiting' AND queue_entered_at IS NOT NULL"
        Assert ($preserved.Trim() -eq '1') 'Upgrade did not preserve the legacy waiting booking.'
        'PASS migration upgrade preserved legacy booking and supplied its queue entry time'
    }
    Wait-Http $authUrl $emulator
    $accounts = foreach ($name in 'patient-a', 'patient-b', 'staff', 'unprovisioned', 'reception', 'doctor-a', 'doctor-b', 'lab', 'admin') {
        $body = @{ email = "$name@example.test"; password = $password; returnSecureToken = $true } | ConvertTo-Json
        Invoke-RestMethod "$authUrl/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo" -Method Post -ContentType 'application/json' -Body $body
    }
    $patientA, $patientB, $staff, $unknown, $reception, $doctorA, $doctorB, $lab, $admin = $accounts.idToken
    @"
INSERT INTO app_users(firebase_uid,role) VALUES
('$($accounts[0].localId)','Patient'),('$($accounts[1].localId)','Patient'),('$($accounts[2].localId)','OpdStaff'),('$($accounts[4].localId)','Reception'),
('$($accounts[5].localId)','Doctor'),('$($accounts[6].localId)','Doctor'),('$($accounts[7].localId)','LabStaff'),('$($accounts[8].localId)','OpdAdmin');
INSERT INTO opd_rooms ("Name","Active") VALUES ('Room A',true),('Room B',true);
INSERT INTO opd_assignments ("RoomId","DoctorId","OpdDate")
SELECT 1,id,(now() AT TIME ZONE 'Asia/Colombo')::date FROM app_users WHERE firebase_uid='$($accounts[5].localId)'
UNION ALL SELECT 2,id,(now() AT TIME ZONE 'Asia/Colombo')::date FROM app_users WHERE firebase_uid='$($accounts[6].localId)';
INSERT INTO opd_bookings(patient_id,idempotency_key,opd_date,token_number,status,called_at)
VALUES ((SELECT id FROM app_users WHERE firebase_uid='$($accounts[0].localId)'),'history-a',(now() AT TIME ZONE 'Asia/Colombo')::date-1,1,'Called',now()-interval '1 day'),
       ((SELECT id FROM app_users WHERE firebase_uid='$($accounts[1].localId)'),'history-b',(now() AT TIME ZONE 'Asia/Colombo')::date-1,2,'Waiting',NULL);
"@ | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1
    Assert ($LASTEXITCODE -eq 0) 'Test data setup failed.'

    $api = Start-Process dotnet -ArgumentList 'bin/Verification/net10.0/MediFlow.Api.dll','--urls',$apiUrl `
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
    Assert ((Read-Response (Send POST $callNext $staff 'before-check-in')).Body.empty) 'Booked tokens must not be called.'
    $checkIn = '/api/opd/reception/check-in'
    Read-Response (Send POST $checkIn $patientA '' @{ tokenNumber = $first.Body.tokenNumber }) 403
    Read-Response (Send POST "$bookings/$firstId/check-in-code" $patientB) 404
    $qr = (Read-Response (Send POST "$bookings/$firstId/check-in-code" $patientA)).Body.code
    "UPDATE opd_bookings SET check_in_expires_at = now() - interval '1 minute' WHERE id = $firstId;" | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1
    Read-Response (Send POST $checkIn $reception '' @{ code = $qr }) 410
    $qr = (Read-Response (Send POST "$bookings/$firstId/check-in-code" $patientA)).Body.code
    $scanA = Send POST $checkIn $reception '' @{ code = $qr }
    $scanB = Send POST $checkIn $reception '' @{ code = $qr }
    $scan = Read-Response $scanA
    Assert ($scan.Body.status -eq 'Waiting' -and (Read-Response $scanB).Raw -ceq $scan.Raw) 'Concurrent QR check-in did not replay.'
    $eventCount = docker exec $container psql -U postgres -tAc 'SELECT count(*) FROM opd_check_ins'
    Assert ($eventCount.Trim() -eq '1') 'Expected one check-in event.'
    foreach ($bookingToCheckIn in @($secondA, $secondB) | Sort-Object tokenNumber) {
        $null = Read-Response (Send POST $checkIn $reception '' @{ tokenNumber = $bookingToCheckIn.tokenNumber })
    }
    $initial = (Read-Response (Send GET $queue $staff)).Body
    Assert (($initial.tokenNumber -join ',') -eq '1,2,3') 'Expected three unique sequential tokens.'
    Read-Response (Send POST "$bookings/$firstId/cancel" $patientB) 404
    Read-Response (Send POST "$queue/$firstId/complete" $staff) 409

    $cancel = Read-Response (Send POST "$bookings/$firstId/cancel" $patientA)
    Assert ($cancel.Body.status -eq 'Cancelled' -and (Read-Response (Send POST "$bookings/$firstId/cancel" $patientA)).Raw -ceq $cancel.Raw) 'Cancellation/replay mismatch.'
    $waiting = (Read-Response (Send GET $bookings $patientB)).Body
    Assert ($waiting.items.Count -eq 1 -and $waiting.items[0].id -eq $secondB.id -and
        $waiting.items[0].waitingAhead -eq ($secondB.tokenNumber - 2)) 'Ownership or waiting-ahead count mismatch.'
    $etaUrl = "$bookings/$($secondB.id)/eta"
    Read-Response (Send GET $etaUrl $patientA) 404
    Read-Response (Send GET $etaUrl) 401
    $estimate = (Read-Response (Send GET $etaUrl $patientB)).Body
    Assert ($estimate.available -and $estimate.approximate -and $estimate.waitingAhead -eq $waiting.items[0].waitingAhead -and $estimate.minutes -eq 0) 'ETA disagrees with queue position or two available rooms.'
    'UPDATE opd_rooms SET "Active"=false;' | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1
    $estimate = (Read-Response (Send GET $etaUrl $patientB)).Body
    Assert (!$estimate.available -and $null -eq $estimate.minutes -and $estimate.reason -eq 'NoServingRooms') 'ETA should be unavailable without rooms.'
    'UPDATE opd_rooms SET "Active"=true;' | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1
    $samples = docker exec $container psql -U postgres -tAc 'SELECT count(*) FROM opd_estimate_samples'
    Assert ($samples.Trim() -eq '3') 'Expected one context sample per check-in.'
    'PASS ETA availability, FIFO count, authorization, and atomic check-in samples'

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
    $walkIn = Send POST '/api/opd/reception/walk-ins' $reception 'walk-in'
    $walkInRetry = Send POST '/api/opd/reception/walk-ins' $reception 'walk-in'
    $issued = Read-Response $walkIn
    Assert ((Read-Response $walkInRetry).Raw -ceq $issued.Raw) 'Walk-in retry changed the token.'
    $lookup = (Read-Response (Send GET "/api/opd/reception/tokens/$($issued.Body.tokenNumber)" $reception)).Body
    Assert ($lookup.status -eq 'Waiting') 'Walk-in must enter Waiting directly.'
    'PASS reception authorization, expired QR, concurrent check-in, manual check-in and walk-in replay'

    $visit = (Read-Response (Send POST $bookings $patientA 'doctor-visit')).Body
    $null = Read-Response (Send POST $checkIn $reception '' @{ tokenNumber = $visit.tokenNumber })
    $roomA = '/api/opd/rooms/1'
    $roomB = '/api/opd/rooms/2'
    Read-Response (Send POST "$roomA/call-next" $doctorB 'wrong-assignment') 403
    Read-Response (Send POST "$roomA/call-next" $patientA 'wrong-role') 403
    $socket = [Net.WebSockets.ClientWebSocket]::new()
    $socketTimeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(15))
    $socket.ConnectAsync([uri]($apiUrl.Replace('http:', 'ws:') + '/hubs/opd'), $socketTimeout.Token).GetAwaiter().GetResult()
    $handshake = [Text.Encoding]::UTF8.GetBytes('{"protocol":"json","version":1}' + [char]30)
    $socket.SendAsync([ArraySegment[byte]]::new($handshake), [Net.WebSockets.WebSocketMessageType]::Text, $true, $socketTimeout.Token).GetAwaiter().GetResult()
    $buffer = [byte[]]::new(8192)
    function Read-Socket {
        $packet = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $socketTimeout.Token).GetAwaiter().GetResult()
        [Text.Encoding]::UTF8.GetString($buffer, 0, $packet.Count)
    }
    Assert ((Read-Socket) -match '\{\}') 'SignalR handshake failed.'
    $claimA = Send POST "$roomA/call-next" $doctorA 'room-call-a'
    $claimB = Send POST "$roomB/call-next" $doctorB 'room-call-b'
    $claimRetry = Send POST "$roomA/call-next" $doctorA 'room-call-a'
    $roomCallA = Read-Response $claimA
    $roomCallB = Read-Response $claimB
    Assert ($roomCallA.Raw -ceq (Read-Response $claimRetry).Raw) 'Room call retry mismatch.'
    Assert ((@($roomCallA.Body.token.tokenNumber, $roomCallB.Body.token.tokenNumber) | Sort-Object) -join ',' -eq '4,5') 'Rooms did not claim distinct FIFO tokens.'
    Read-Response (Send POST "$roomA/call-next" $doctorA 'room-busy') 409
    $snapshot = (Read-Response (Send GET '/api/opd/display')).Body
    Assert ($snapshot.Count -eq 2 -and ($snapshot[0].PSObject.Properties.Name -join ',') -eq 'tokenNumber,room') 'Public snapshot leaked private fields.'
    $event = Read-Socket
    Assert ($event -match 'DisplayUpdated' -and $event -match 'tokenNumber' -and $event -notmatch 'patientId|bookingId|doctorId') 'Public SignalR event mismatch.'
    $socket.Dispose()
    $roomTokenA = $roomCallA.Body.token.id
    $roomTokenB = $roomCallB.Body.token.id
    Read-Response (Send POST "$roomA/tokens/$roomTokenA/complete" $doctorA) 409
    Read-Response (Send POST "$queue/$roomTokenA/complete" $staff) 409
    Read-Response (Send POST "$roomB/tokens/$roomTokenA/start" $doctorB) 404
    $null = Read-Response (Send POST "$roomA/tokens/$roomTokenA/no-show" $doctorA)
    $null = Read-Response (Send POST "$roomA/tokens/$roomTokenA/requeue" $doctorA)
    $eventCount = 'SELECT count(*) FROM opd_queue_events WHERE "Action"=''requeue'';' | docker exec -i $container psql -U postgres -tA
    Assert ($eventCount.Trim() -eq '1') 'Requeue audit event missing.'
    $start = Send POST "$roomB/tokens/$roomTokenB/start" $doctorB
    $startRetry = Send POST "$roomB/tokens/$roomTokenB/start" $doctorB
    Assert ((Read-Response $start).Raw -ceq (Read-Response $startRetry).Raw) 'Concurrent consultation start was not stable.'
    Read-Response (Send POST "$roomB/tokens/$roomTokenB/no-show" $doctorB) 409
    $null = Read-Response (Send POST "$roomB/tokens/$roomTokenB/complete" $doctorB)
    Assert ((Read-Response (Send POST "$roomB/call-next" $doctorB 'recalled')).Body.token.id -eq $roomTokenA) 'Requeued token was not callable.'
    'PASS doctor assignments, simultaneous room claims, room occupancy, consultation transitions, requeue audit and public snapshot privacy'

    $null = Read-Response (Send POST "$roomB/tokens/$roomTokenA/start" $doctorB)
    $null = Read-Response (Send POST "$roomB/tokens/$roomTokenA/complete" $doctorB)
    $clinical = '/api/clinical'
    $record = "$clinical/visits/$($visit.id)"
    Read-Response (Send GET $record $doctorA) 404
    Read-Response (Send GET $record $admin) 403
    Read-Response (Send GET $record $lab) 403
    Read-Response (Send GET "$clinical/me/visits") 401
    $null = Read-Response (Send PUT "$record/note" $doctorB '' @{ notes = 'Private synthetic note'; summary = 'Synthetic visit summary' })
    Assert ((Read-Response (Send GET "$clinical/me/visits" $patientA)).Raw -eq '[]') 'Draft visit was visible.'
    $null = Read-Response (Send POST "$record/publish" $doctorB)
    $summaries = Read-Response (Send GET "$clinical/me/visits" $patientA)
    Assert ($summaries.Body[0].summary -eq 'Synthetic visit summary' -and $summaries.Raw -notmatch 'Private synthetic note') 'Patient summary leaked notes or was missing.'
    Assert ((Read-Response (Send GET "$clinical/me/visits" $patientB)).Raw -eq '[]') 'Other patient saw the visit summary.'

    $request = (Read-Response (Send POST "$record/lab" $doctorB '' @{ test = 'Demo panel' })).Body
    $labRoute = "$clinical/lab/$($request.id)"
    Read-Response (Send POST "$labRoute/verify" $lab) 409
    $worklist = (Read-Response (Send GET "$clinical/lab/worklist" $lab)).Body
    Assert (($worklist[0].PSObject.Properties.Name -join ',') -eq 'id,test,status,result') 'Lab worklist leaked identifiers.'
    $null = Read-Response (Send PUT "$labRoute/result" $lab '' @{ result = 'Synthetic result' })
    Read-Response (Send POST "$labRoute/publish" $doctorB) 409
    $null = Read-Response (Send POST "$labRoute/verify" $lab)
    Assert ((Read-Response (Send GET "$clinical/me/lab" $patientA)).Raw -eq '[]') 'Unpublished lab result was visible.'
    Read-Response (Send POST "$labRoute/publish" $doctorA) 404
    $null = Read-Response (Send POST "$labRoute/publish" $doctorB)
    Assert ((Read-Response (Send GET "$clinical/me/lab" $patientA)).Body[0].result -eq 'Synthetic result') 'Published lab result missing.'
    Assert ((Read-Response (Send GET "$clinical/me/lab" $patientB)).Raw -eq '[]') 'Other patient saw the lab result.'

    $secondVisit = (Read-Response (Send POST $bookings $patientB 'second-clinical-visit')).Body
    $null = Read-Response (Send POST $checkIn $reception '' @{ tokenNumber = $secondVisit.tokenNumber })
    Assert ((Read-Response (Send POST "$roomB/call-next" $doctorB 'clinical-patient-b')).Body.token.id -eq $secondVisit.id) 'Wrong second clinical visit.'
    $null = Read-Response (Send POST "$roomB/tokens/$($secondVisit.id)/start" $doctorB)
    $null = Read-Response (Send POST "$roomB/tokens/$($secondVisit.id)/complete" $doctorB)
    $slotStart = [DateTimeOffset]::Parse([DateTimeOffset]::UtcNow.AddHours(2).ToString("yyyy-MM-dd'T'HH:mm':00+00:00'"))
    $slot = (Read-Response (Send POST "$clinical/slots" $doctorB '' @{ startsAt = $slotStart.ToString('o'); capacity = 1 })).Body
    $slotA = Send POST "$record/follow-up/$($slot.id)" $doctorB
    $slotB = Send POST "$clinical/visits/$($secondVisit.id)/follow-up/$($slot.id)" $doctorB
    $slotStatuses = @([int]$slotA.GetAwaiter().GetResult().StatusCode, [int]$slotB.GetAwaiter().GetResult().StatusCode)
    Assert (($slotStatuses | Sort-Object) -join ',' -eq '200,409') 'Concurrent final slot was not allocated exactly once.'
    $appointmentsA = (Read-Response (Send GET "$clinical/me/appointments" $patientA)).Body
    $appointmentsB = (Read-Response (Send GET "$clinical/me/appointments" $patientB)).Body
    Assert (($appointmentsA.Count + $appointmentsB.Count) -eq 1 -and $appointmentsA.Count -eq [int]($slotStatuses[0] -eq 200)) 'Appointment ownership mismatch.'
    'PASS consultation privacy, lab state machine and publication, appointment ownership and concurrent final-slot allocation'

    $operations = '/api/opd/admin'
    Read-Response (Send GET "$operations/counts") 401
    Read-Response (Send GET "$operations/counts" $staff) 403
    $department = (Read-Response (Send POST "$operations/departments" $admin '' @{ name = 'Synthetic OPD' })).Body
    $room = (Read-Response (Send POST "$operations/rooms" $admin '' @{ name = 'Room C'; departmentId = $department.id })).Body
    $doctorProfile = (Read-Response (Send GET '/api/me' $doctorA)).Body
    Read-Response (Send POST "$operations/assignments" $admin '' @{ roomId = $room.id; doctorId = $doctorProfile.id; opdDate = $current }) 409
    Read-Response (Send POST "$operations/assignments" $admin '' @{ roomId = 1; doctorId = $doctorProfile.id; opdDate = $past }) 400
    $assignment = @{ roomId = $room.id; doctorId = $doctorProfile.id; opdDate = $future }
    $newAssignment = Read-Response (Send POST "$operations/assignments" $admin '' $assignment)
    Assert ((Read-Response (Send POST "$operations/assignments" $admin '' $assignment)).Raw -ceq $newAssignment.Raw) 'Assignment replay mismatch.'
    $otherDoctor = (Read-Response (Send GET '/api/me' $doctorB)).Body
    Read-Response (Send POST "$operations/assignments" $admin '' @{ roomId = $room.id; doctorId = $otherDoctor.id; opdDate = $future }) 409
    $counts = (Read-Response (Send GET "$operations/counts" $admin)).Body
    Assert ($counts.opdDate -eq $current -and ($counts.counts | Measure-Object -Property count -Sum).Sum -eq 6) 'Operational counts mismatch.'
    $auditCount = docker exec $container psql -U postgres -tAc 'SELECT count(*) FROM opd_admin_events'
    Assert ($auditCount.Trim() -eq '3') 'Admin audit should record only successful changes.'

    $alerts = '/api/opd/notifications'
    Read-Response (Send GET $alerts $lab) 403
    $appointmentOwner = if ($slotStatuses[0] -eq 200) { $patientA } else { $patientB }
    $otherOwner = if ($slotStatuses[0] -eq 200) { $patientB } else { $patientA }
    $badOutbox = 'INSERT INTO opd_notification_outbox ("PatientId","Kind","DueAt","Attempts") VALUES ((SELECT min(id) FROM app_users),''Unsupported'',now(),4);'
    $badOutbox | docker exec -i $container psql -U postgres -v ON_ERROR_STOP=1
    for ($i=0; $i -lt 15; $i++) {
        $delivered = (Read-Response (Send GET $alerts $appointmentOwner)).Body
        $failed = 'SELECT count(*) FROM opd_notification_outbox WHERE "Kind"=''Unsupported'' AND "FailedAt" IS NOT NULL AND "Attempts"=5;' |
            docker exec -i $container psql -U postgres -tA
        if (@($delivered | Where-Object kind -eq 'AppointmentReminder').Count -eq 1 -and $failed.Trim() -eq '1') { break }
        Start-Sleep -Seconds 1
    }
    Assert ($failed.Trim() -eq '1' -and @($delivered | Where-Object kind -eq 'AppointmentReminder').Count -eq 1) 'Outbox delivery/failure did not settle.'
    Assert (@($delivered | Where-Object smsDelivery -ne 'Simulated').Count -eq 0) 'SMS must be labelled simulated.'
    Assert (@((Read-Response (Send GET $alerts $otherOwner)).Body | Where-Object kind -eq 'AppointmentReminder').Count -eq 0) 'Reminder leaked to another patient.'
    $callsForOwner = (Read-Response (Send GET $alerts $calledOwner)).Body
    Assert (@($callsForOwner | Where-Object { $_.kind -eq 'TokenCalled' -and $_.tokenNumber -eq 2 }).Count -eq 1) 'Call replay produced duplicate or missing notification.'
    'PASS admin permissions, room/doctor overlap, audit, outbox delivery, simulated SMS, retry cap and alert ownership'

    $assistant = '/api/opd/assistant/query'
    $index = '/api/opd/admin/faq/index'
    Read-Response (Send POST $assistant '' '' @{ kind = 'tokens' }) 401
    Read-Response (Send POST $assistant $admin '' @{ kind = 'tokens' }) 403
    Read-Response (Send POST $index $patientA) 403
    if ($Vector) {
        Assert ((Read-Response (Send POST $index $admin)).Body.indexed -eq 3) 'Expected three embedded demo sources.'
    } else { Read-Response (Send POST $index $admin) 409 }
    $faq = (Read-Response (Send POST $assistant $patientA '' @{ kind = 'faq'; question = 'walkin walk-ins account print printed paper' })).Body
    $expectedRetrieval = if ($Vector) { 'Pgvector' } else { 'Keywords' }
    Assert ($faq.grounded -and $faq.retrieval -eq $expectedRetrieval -and $faq.sources[0].source -like 'Synthetic*') 'Expected a sourced demo guide.'
    $unsupported = (Read-Response (Send POST $assistant $patientA '' @{ kind = 'faq'; question = 'Where is the astronomy telescope?' })).Body
    Assert (!$unsupported.grounded -and $unsupported.sources.Count -eq 0) 'Unsupported FAQ should fall back.'
    $assistantTokens = (Read-Response (Send POST $assistant $patientA '' @{ kind = 'tokens'; patientId = 999 })).Body
    $myTokens = (Read-Response (Send GET $bookings $patientA)).Body
    Assert (($assistantTokens.items.id -join ',') -eq ($myTokens.items.id -join ',')) 'Assistant token ownership mismatch.'
    $assistantAppointments = (Read-Response (Send POST $assistant $patientA '' @{ kind = 'appointments'; patientId = 999 })).Body
    Assert (($assistantAppointments.items.id -join ',') -eq ($appointmentsA.id -join ',')) 'Assistant appointment ownership mismatch.'
    "PASS practical FAQ sources, fallback, role checks, personal-data isolation and retrieval mode $expectedRetrieval"

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
