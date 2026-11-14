using System.Data;
using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api.Data;

public sealed class OpdBooking
{
    private static readonly TimeZoneInfo OpdTimeZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Colombo");

    public long Id { get; init; }
    public int PatientId { get; init; }
    public required string IdempotencyKey { get; init; }
    public DateOnly OpdDate { get; init; }
    public int TokenNumber { get; init; }

    public static async Task<OpdBooking> CreateOrReplayAsync(
        MediFlowDbContext db, int patientId, string key, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        // Serialize the lookup and allocation across API instances. The transaction releases the lock.
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(1451986, 1)", cancellationToken);

        var booking = await db.OpdBookings.AsNoTracking().SingleOrDefaultAsync(
            item => item.PatientId == patientId && item.IdempotencyKey == key, cancellationToken);
        if (booking is null)
        {
            var opdDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, OpdTimeZone).DateTime);
            var lastToken = await db.OpdBookings.Where(item => item.OpdDate == opdDate)
                .MaxAsync(item => (int?)item.TokenNumber, cancellationToken) ?? 0;
            booking = new OpdBooking
            {
                PatientId = patientId,
                IdempotencyKey = key,
                OpdDate = opdDate,
                TokenNumber = checked(lastToken + 1)
            };
            db.OpdBookings.Add(booking);
            await db.SaveChangesAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return booking;
    }
}
