using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using MediFlow.Api.Auth;
using MediFlow.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using System.Data;
using System.Globalization;
using System.Security.Claims;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<MediFlowDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("MediFlow")));

builder.Services.AddSingleton(_ => FirebaseApp.Create(new AppOptions
{
    ProjectId = builder.Configuration["Firebase:ProjectId"],
    Credential = GoogleCredential.GetApplicationDefault()
}));

builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(builder.Configuration["Frontend:Origin"]!)
        .WithMethods("GET", "POST")
        .WithHeaders("Authorization", "Idempotency-Key")
        .WithExposedHeaders("X-Opd-Date")));

builder.Services.AddAuthentication(FirebaseBearerHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, FirebaseBearerHandler>(
        FirebaseBearerHandler.SchemeName, _ => { });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("AppUser", policy => policy.RequireAuthenticatedUser()
        .RequireClaim(FirebaseBearerHandler.AppUserIdClaim))
    .AddPolicy("Patient", policy => policy.RequireRole("Patient"))
    .AddPolicy("OpdStaff", policy => policy.RequireRole("OpdStaff"));

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

var api = app.MapGroup("/api").RequireAuthorization("AppUser");

api.MapGet("/me", (ClaimsPrincipal user) => Results.Ok(new
{
    id = int.Parse(user.FindFirstValue(FirebaseBearerHandler.AppUserIdClaim)!),
    firebaseUid = user.FindFirstValue(ClaimTypes.NameIdentifier),
    role = user.FindFirstValue(ClaimTypes.Role)
}));

var bookings = api.MapGroup("/opd/bookings").RequireAuthorization("Patient");

bookings.MapGet("", async (HttpResponse response, ClaimsPrincipal user,
    MediFlowDbContext db, CancellationToken cancellationToken) =>
{
    var patientId = int.Parse(user.FindFirstValue(FirebaseBearerHandler.AppUserIdClaim)!);
    var opdDate = OpdBooking.Today();
    response.Headers.CacheControl = "no-store";
    return await db.OpdBookings.AsNoTracking()
        .Where(booking => booking.PatientId == patientId && booking.OpdDate == opdDate)
        .OrderBy(booking => booking.TokenNumber)
        .Select(booking => new
        {
            booking.Id,
            booking.OpdDate,
            booking.TokenNumber,
            booking.Status,
            booking.CalledAt,
            booking.CompletedAt,
            WaitingAhead = booking.Status == OpdBooking.Waiting
                ? (int?)db.OpdBookings.Count(earlier => earlier.OpdDate == booking.OpdDate
                    && earlier.Status == OpdBooking.Waiting
                    && earlier.TokenNumber < booking.TokenNumber)
                : null
        })
        .ToListAsync(cancellationToken);
});

bookings.MapPost("", async (HttpRequest request, ClaimsPrincipal user,
    MediFlowDbContext db, CancellationToken cancellationToken) =>
{
    var key = ReadIdempotencyKey(request);
    if (key is null)
        return InvalidIdempotencyKey();

    var patientId = int.Parse(user.FindFirstValue(FirebaseBearerHandler.AppUserIdClaim)!);
    var booking = await OpdBooking.CreateOrReplayAsync(db, patientId, key, cancellationToken);
    return Results.Ok(new { booking.Id, booking.OpdDate, booking.TokenNumber });
});

bookings.MapPost("/{bookingId:long}/cancel", async (long bookingId, ClaimsPrincipal user,
    MediFlowDbContext db, CancellationToken cancellationToken) =>
{
    var patientId = int.Parse(user.FindFirstValue(FirebaseBearerHandler.AppUserIdClaim)!);
    await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
    await OpdBooking.LockQueueAsync(db, cancellationToken);

    var today = OpdBooking.Today();
    var booking = await db.OpdBookings.SingleOrDefaultAsync(
        item => item.Id == bookingId && item.PatientId == patientId && item.OpdDate == today, cancellationToken);
    if (booking is null)
        return Results.NotFound(new { error = "Booking was not found in today's bookings." });
    if (booking.Status != OpdBooking.Waiting && booking.Status != OpdBooking.Cancelled)
        return Results.Conflict(new { error = "Only waiting tokens can be cancelled." });

    if (booking.Status == OpdBooking.Waiting)
    {
        booking.Status = OpdBooking.Cancelled;
        await db.SaveChangesAsync(cancellationToken);
    }

    await transaction.CommitAsync(cancellationToken);
    return Results.Ok(new { booking.Id, booking.OpdDate, booking.TokenNumber, booking.Status, booking.CalledAt, booking.CompletedAt });
});

var queue = api.MapGroup("/opd/queue").RequireAuthorization("OpdStaff");
queue.MapGet("", async (HttpRequest request, HttpResponse response, MediFlowDbContext db, CancellationToken cancellationToken) =>
{
    response.Headers.CacheControl = "no-store";
    var today = OpdBooking.Today();
    var date = today;
    if (request.Query.TryGetValue("date", out var dates)
        && (dates.Count != 1 || !DateOnly.TryParseExact(dates[0], "yyyy-MM-dd",
            CultureInfo.InvariantCulture, DateTimeStyles.None, out date) || date > today))
        return Results.BadRequest(new { error = "Use an OPD date in YYYY-MM-DD format on or before today." });

    var items = await db.OpdBookings.AsNoTracking().Where(booking => booking.OpdDate == date)
        .OrderBy(booking => booking.TokenNumber)
        .Select(booking => new { booking.Id, booking.TokenNumber, booking.Status, booking.CalledAt, booking.CompletedAt })
        .ToListAsync(cancellationToken);
    response.Headers["X-Opd-Date"] = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    return Results.Ok(items);
});

queue.MapPost("/call-next", async (HttpRequest request, ClaimsPrincipal user,
    MediFlowDbContext db, CancellationToken cancellationToken) =>
{
    var key = ReadIdempotencyKey(request);
    if (key is null)
        return InvalidIdempotencyKey();

    var staffId = int.Parse(user.FindFirstValue(FirebaseBearerHandler.AppUserIdClaim)!);
    var booking = await OpdCallAction.CallNextAsync(db, staffId, key, cancellationToken);
    return Results.Ok(new
    {
        empty = booking is null,
        token = booking is null ? null : new { booking.TokenNumber, Status = OpdBooking.Called, booking.CalledAt, booking.OpdDate }
    });
});

queue.MapPost("/{bookingId:long}/complete", async (long bookingId,
    MediFlowDbContext db, CancellationToken cancellationToken) =>
{
    var today = OpdBooking.Today();
    var target = db.OpdBookings.Where(booking => booking.Id == bookingId && booking.OpdDate == today);
    await target.Where(booking => booking.Status == OpdBooking.Called)
        .ExecuteUpdateAsync(setters => setters
            .SetProperty(booking => booking.Status, OpdBooking.Completed)
            .SetProperty(booking => booking.CompletedAt, DateTimeOffset.UtcNow), cancellationToken);

    var result = await target.AsNoTracking()
        .Select(booking => new { booking.Id, booking.TokenNumber, booking.Status, booking.CalledAt, booking.CompletedAt })
        .SingleOrDefaultAsync(cancellationToken);
    if (result is null)
        return Results.NotFound(new { error = "Booking was not found in today's queue." });
    if (result.Status != OpdBooking.Completed)
        return Results.Conflict(new { error = "Call this token before completing it." });
    return Results.Ok(result);
});

app.Run();

static string? ReadIdempotencyKey(HttpRequest request)
{
    var keys = request.Headers["Idempotency-Key"];
    var key = keys.Count == 1 ? keys[0]?.Trim() : null;
    return string.IsNullOrEmpty(key) || key.Length > 128 || key.Any(c => c < '!' || c > '~' || c == ',')
        ? null : key;
}

static IResult InvalidIdempotencyKey() =>
    Results.BadRequest(new { error = "Supply one Idempotency-Key of 1–128 visible ASCII characters without commas." });
