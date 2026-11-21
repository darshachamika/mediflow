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
        var observedAt = DateTimeOffset.UtcNow;
        var recent = await db.OpdBookings.AsNoTracking()
            .Where(item => item.OpdDate >= earliest && item.OpdDate <= day && item.Status == OpdBooking.Completed
                && item.StartedAt != null && item.CompletedAt > item.StartedAt && item.CompletedAt <= observedAt)
            .OrderByDescending(item => item.CompletedAt).ThenByDescending(item => item.Id).Take(30)
            .Select(item => new { item.StartedAt, item.CompletedAt }).ToListAsync(ct);
        var durations = recent.Select(item => (item.CompletedAt!.Value - item.StartedAt!.Value).TotalMinutes)
            .Where(minutes => minutes >= 1 && minutes <= 180).ToArray();
        return new OpdEstimateSample
        {
            Booking = booking, ObservedAt = observedAt, WaitingAhead = ahead,
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
        bookings.MapGet("/{id:long}/eta", async (long id, ClaimsPrincipal user, MediFlowDbContext db, OpdEta eta, EtaPredictor model, CancellationToken ct) =>
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
            var baseline = WaitEstimate.Minutes(sample.WaitingAhead, sample.ServingRooms, sample.BusyRooms, sample.ConsultationMinutes);
            // Use the immutable entry snapshot to predict total waiting time, then subtract elapsed waiting.
            // The live baseline caps it so cancellations and extra serving rooms are reflected immediately.
            var entry = await db.Set<OpdEstimateSample>().AsNoTracking().SingleOrDefaultAsync(item => item.BookingId == id, ct);
            var predicted = entry is not null && booking.QueueEnteredAt is { } entered
                && entry.ObservedAt >= entered && entry.ObservedAt <= entered.AddSeconds(5)
                ? model.Predict(EtaFeatures.From(entry.WaitingAhead, entry.ServingRooms, entry.BusyRooms, entry.ConsultationMinutes)) : null;
            var remaining = predicted.HasValue
                ? Math.Max(0, predicted.Value - (DateTimeOffset.UtcNow - booking.QueueEnteredAt!.Value).TotalMinutes) : (double?)null;
            var minutes = baseline.HasValue && remaining.HasValue ? Math.Min(baseline.Value, (int)Math.Ceiling(remaining.Value)) : baseline;
            return Results.Ok(new { approximate = true, available = minutes.HasValue, minutes,
                sample.WaitingAhead, reason = minutes.HasValue ? null : "NoServingRooms",
                source = baseline.HasValue && remaining.HasValue ? "Model" : "Baseline",
                modelVersion = baseline.HasValue && remaining.HasValue ? model.Version : null });
        });
    }
}
