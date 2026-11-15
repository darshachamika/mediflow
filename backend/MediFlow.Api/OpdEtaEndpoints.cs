using System.Security.Claims;
using MediFlow.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api;

internal sealed class OpdEta(double fallbackMinutes)
{
    internal async Task<OpdEstimateSample> Observe(MediFlowDbContext db, OpdBooking booking, CancellationToken ct)
    {
        var day = booking.OpdDate;
        var entered = booking.QueueEnteredAt;
        var number = booking.TokenNumber;
        var queue = OpdBooking.WaitingQueue(db, day);
        var ahead = await queue.CountAsync(item => item.QueueEnteredAt < entered
            || (item.QueueEnteredAt == entered && item.TokenNumber < number)
            || (item.QueueEnteredAt != null && entered == null), ct);
        var serving = db.Set<OpdAssignment>().Where(a => a.OpdDate == day && a.Room.Active).Select(a => a.RoomId);
        var rooms = await serving.CountAsync(ct);
        var busy = await db.OpdBookings.CountAsync(item => item.OpdDate == day && item.RoomId.HasValue
            && serving.Contains(item.RoomId.Value)
            && (item.Status == OpdBooking.Called || item.Status == OpdBooking.InConsultation), ct);
        var earliest = day.AddDays(-30);
        var recent = await db.OpdBookings.AsNoTracking()
            .Where(item => item.OpdDate >= earliest && item.OpdDate <= day && item.Status == OpdBooking.Completed
                && item.StartedAt != null && item.CompletedAt > item.StartedAt)
            .OrderByDescending(item => item.CompletedAt).ThenByDescending(item => item.Id).Take(30)
            .Select(item => new { item.StartedAt, item.CompletedAt }).ToListAsync(ct);
        var durations = recent.Select(item => (item.CompletedAt!.Value - item.StartedAt!.Value).TotalMinutes)
            .Where(minutes => minutes >= 1 && minutes <= 180).ToArray();
        return new OpdEstimateSample
        {
            Booking = booking, ObservedAt = DateTimeOffset.UtcNow, WaitingAhead = ahead,
            ServingRooms = rooms, BusyRooms = busy,
            ConsultationMinutes = durations.Length == 0 ? fallbackMinutes : durations.Average(),
            UsesFallback = durations.Length == 0
        };
    }
}

internal static class OpdEtaEndpoints
{
    internal static void MapEta(this RouteGroupBuilder bookings)
    {
        bookings.MapGet("/{id:long}/eta", async (long id, ClaimsPrincipal user, MediFlowDbContext db, OpdEta eta, CancellationToken ct) =>
        {
            var owner = ReceptionEndpoints.UserId(user);
            var today = OpdBooking.Today();
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
            var booking = await db.OpdBookings.AsNoTracking().SingleOrDefaultAsync(item =>
                item.Id == id && item.PatientId == owner && item.OpdDate == today, ct);
            if (booking is null) return Results.NotFound();
            if (booking.Status != OpdBooking.Waiting)
                return Results.Ok(new { approximate = true, available = false, minutes = (int?)null, reason = "NotWaiting" });
            var sample = await eta.Observe(db, booking, ct);
            var minutes = WaitEstimate.Minutes(sample.WaitingAhead, sample.ServingRooms, sample.BusyRooms, sample.ConsultationMinutes);
            return Results.Ok(new { approximate = true, available = minutes.HasValue, minutes,
                sample.WaitingAhead, reason = minutes.HasValue ? null : "NoServingRooms" });
        });
    }
}
