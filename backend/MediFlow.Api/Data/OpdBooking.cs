using System.Data;
using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api.Data;

public sealed class OpdBooking
{
    private static readonly TimeZoneInfo OpdTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Colombo");

    public static DateOnly Today() =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, OpdTimeZone).DateTime);

    public long Id { get; init; }
    public int? PatientId { get; init; }
    public int? IssuedById { get; init; }
    public required string IdempotencyKey { get; init; }
    public DateOnly OpdDate { get; init; }
    public int TokenNumber { get; init; }
    public const string Waiting = "Waiting";
    public const string Booked = "Booked";
    public const string Called = "Called";
    public const string Completed = "Completed";
    public const string Cancelled = "Cancelled";
    public string Status { get; set; } = Waiting;
    public DateTimeOffset? CalledAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset? QueueEnteredAt { get; set; }
    public string? CheckInHash { get; set; }
    public DateTimeOffset? CheckInExpiresAt { get; set; }

    // Booking, calling and cancellation share this lock so the head of the queue is stable.
    internal static Task LockQueueAsync(MediFlowDbContext db, CancellationToken cancellationToken) =>
        db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(1451986, 1)", cancellationToken);

    public static async Task<OpdBooking> CreateOrReplayAsync(
        MediFlowDbContext db, int? patientId, string key, CancellationToken cancellationToken, int? issuedById = null)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        await LockQueueAsync(db, cancellationToken);

        var booking = await db.OpdBookings.AsNoTracking().SingleOrDefaultAsync(
            item => item.PatientId == patientId && item.IssuedById == issuedById && item.IdempotencyKey == key, cancellationToken);
        if (booking is null)
        {
            var opdDate = Today();
            var lastToken = await db.OpdBookings.Where(item => item.OpdDate == opdDate)
                .MaxAsync(item => (int?)item.TokenNumber, cancellationToken) ?? 0;
            booking = new OpdBooking
            {
                PatientId = patientId,
                IssuedById = issuedById,
                IdempotencyKey = key,
                OpdDate = opdDate,
                TokenNumber = checked(lastToken + 1),
                Status = patientId.HasValue ? Booked : Waiting,
                QueueEnteredAt = patientId.HasValue ? null : DateTimeOffset.UtcNow
            };
            db.OpdBookings.Add(booking);
            if (issuedById is int receptionist)
                db.Add(new OpdCheckIn { Booking = booking, StaffId = receptionist, Method = "WalkIn", JoinedAt = booking.QueueEnteredAt!.Value });
            await db.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return booking;
    }
}
