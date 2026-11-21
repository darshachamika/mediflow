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
    public const string InConsultation = "InConsultation";
    public const string NoShow = "NoShow";
    public const string Completed = "Completed";
    public const string Cancelled = "Cancelled";
    public string Status { get; set; } = Waiting;
    public DateTimeOffset? CalledAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public int? RoomId { get; set; }
    public int? DoctorId { get; set; }
    public DateTimeOffset? QueueEnteredAt { get; set; }
    public string? CheckInHash { get; set; }
    public DateTimeOffset? CheckInExpiresAt { get; set; }

    // Booking, calling and cancellation share this lock so the head of the queue is stable.
    internal static Task LockQueueAsync(MediFlowDbContext db, CancellationToken cancellationToken) =>
        db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(1451986, 1)", cancellationToken);

    internal static IQueryable<OpdBooking> WaitingQueue(MediFlowDbContext db, DateOnly date) =>
        db.OpdBookings.Where(item => item.OpdDate == date && item.Status == Waiting)
            .OrderBy(item => item.QueueEnteredAt).ThenBy(item => item.TokenNumber);

    internal static IQueryable<PatientBooking> OwnBookings(MediFlowDbContext db, int owner, DateOnly day, DateOnly today) =>
        db.OpdBookings.AsNoTracking().Where(booking => booking.PatientId == owner && booking.OpdDate == day)
            .OrderBy(booking => booking.TokenNumber)
            .Select(booking => new PatientBooking(booking.Id, booking.OpdDate, booking.TokenNumber, booking.Status,
                booking.CalledAt, booking.CompletedAt, day == today && booking.Status == Waiting
                    ? db.OpdBookings.Count(earlier => earlier.OpdDate == booking.OpdDate && earlier.Status == Waiting
                        && (earlier.QueueEnteredAt < booking.QueueEnteredAt
                            || (earlier.QueueEnteredAt == booking.QueueEnteredAt && earlier.TokenNumber < booking.TokenNumber)
                            || (earlier.QueueEnteredAt != null && booking.QueueEnteredAt == null)))
                    : null));

    internal static async Task<OpdBooking> CreateOrReplayAsync(
        MediFlowDbContext db, int? patientId, string key, CancellationToken cancellationToken, int? issuedById = null, OpdEta? eta = null)
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
            {
                db.Add(new OpdCheckIn { Booking = booking, StaffId = receptionist, Method = "WalkIn", JoinedAt = booking.QueueEnteredAt!.Value });
                db.Add(await eta!.Observe(db, booking, cancellationToken));
            }
            await db.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return booking;
    }
}

internal sealed record PatientBooking(long Id, DateOnly OpdDate, int TokenNumber, string Status,
    DateTimeOffset? CalledAt, DateTimeOffset? CompletedAt, int? WaitingAhead);
