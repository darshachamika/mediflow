using System.Data;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using MediFlow.Api.Auth;
using MediFlow.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api;

internal static class ReceptionEndpoints
{
    internal static int UserId(ClaimsPrincipal user) =>
        int.Parse(user.FindFirstValue(FirebaseBearerHandler.AppUserIdClaim)!);

    internal static void MapReception(this RouteGroupBuilder api, RouteGroupBuilder bookings, Func<HttpRequest, string?> readKey)
    {
        bookings.MapPost("/{id:long}/check-in-code", async (long id, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await OpdBooking.LockQueueAsync(db, ct);
            var today = OpdBooking.Today();
            var patient = UserId(user);
            var booking = await db.OpdBookings.SingleOrDefaultAsync(b => b.Id == id && b.PatientId == patient && b.OpdDate == today, ct);
            if (booking is null) return Results.NotFound();
            if (booking.Status != OpdBooking.Booked) return Results.Conflict();
            var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            booking.CheckInHash = Hash(code);
            booking.CheckInExpiresAt = DateTimeOffset.UtcNow.AddMinutes(15);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Ok(new { code, expiresAt = booking.CheckInExpiresAt });
        });

        var reception = api.MapGroup("/opd/reception").RequireAuthorization("Reception");
        reception.MapGet("/tokens/{number:int}", async (int number, MediFlowDbContext db, CancellationToken ct) =>
        {
            var today = OpdBooking.Today();
            var booking = await db.OpdBookings.AsNoTracking().SingleOrDefaultAsync(b => b.OpdDate == today && b.TokenNumber == number, ct);
            return booking is null ? Results.NotFound() : Results.Ok(Token(booking));
        });
        reception.MapPost("/check-in", async (CheckInRequest request, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            if ((request.Code is null) == (request.TokenNumber is null) || request.TokenNumber is <= 0
                || (request.Code is not null && (request.Code.Length != 64 || !request.Code.All(Uri.IsHexDigit))))
                return Results.BadRequest(new { error = "Supply one check-in code or token number." });

            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await OpdBooking.LockQueueAsync(db, ct);
            var today = OpdBooking.Today();
            var hash = request.Code is null ? null : Hash(request.Code.ToUpperInvariant());
            var booking = await db.OpdBookings.SingleOrDefaultAsync(b => b.OpdDate == today &&
                (hash == null ? b.TokenNumber == request.TokenNumber : b.CheckInHash == hash), ct);
            if (booking is null) return Results.NotFound();
            var existing = await db.Set<OpdCheckIn>().FindAsync([booking.Id], ct);
            if (existing is not null && existing.Method != "WalkIn")
                return Results.Ok(new { booking.Id, booking.TokenNumber, booking.OpdDate, Status = OpdBooking.Waiting, existing.JoinedAt });
            if (booking.Status != OpdBooking.Booked) return Results.Conflict();
            if (hash is not null && booking.CheckInExpiresAt <= DateTimeOffset.UtcNow)
                return Results.StatusCode(StatusCodes.Status410Gone);
            var now = DateTimeOffset.UtcNow;
            var joinedAt = now.AddTicks(-(now.Ticks % 10));
            booking.Status = OpdBooking.Waiting;
            booking.QueueEnteredAt = joinedAt;
            db.Add(new OpdCheckIn { Booking = booking, StaffId = UserId(user), Method = hash is null ? "Manual" : "QR", JoinedAt = joinedAt });
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Ok(new { booking.Id, booking.TokenNumber, booking.OpdDate, booking.Status, JoinedAt = joinedAt });
        });
        reception.MapPost("/walk-ins", async (HttpRequest request, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            var key = readKey(request);
            if (key is null) return Results.BadRequest(new { error = "Supply a valid Idempotency-Key." });
            var booking = await OpdBooking.CreateOrReplayAsync(db, null, key, ct, UserId(user));
            return Results.Ok(new { booking.Id, booking.TokenNumber, booking.OpdDate });
        });
    }

    private static string Hash(string code) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
    private static object Token(OpdBooking booking) => new { booking.Id, booking.TokenNumber, booking.OpdDate, booking.Status };
    private sealed record CheckInRequest(string? Code, int? TokenNumber);
}
