using System.Data;
using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api.Data;

public sealed class OpdCallAction
{
    public int StaffId { get; init; }
    public required string IdempotencyKey { get; init; }
    public long? BookingId { get; init; }
    public OpdBooking? Booking { get; init; }

    public static async Task<OpdBooking?> CallNextAsync(
        MediFlowDbContext db, int staffId, string key, CancellationToken cancellationToken)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken);
        await OpdBooking.LockQueueAsync(db, cancellationToken);

        var previous = await db.OpdCallActions.AsNoTracking().Include(action => action.Booking)
            .SingleOrDefaultAsync(action => action.StaffId == staffId && action.IdempotencyKey == key, cancellationToken);
        if (previous is not null)
            return previous.Booking;

        var today = OpdBooking.Today();
        var next = await db.OpdBookings.Where(booking => booking.OpdDate == today && booking.Status == OpdBooking.Waiting)
            .OrderBy(booking => booking.TokenNumber)
            .FirstOrDefaultAsync(cancellationToken);
        if (next is not null)
        {
            next.Status = OpdBooking.Called;
            // PostgreSQL stores microseconds. Return the same timestamp on the first call and on replay.
            var utcNow = DateTimeOffset.UtcNow;
            next.CalledAt = utcNow.AddTicks(-(utcNow.Ticks % 10));
        }

        db.OpdCallActions.Add(new OpdCallAction { StaffId = staffId, IdempotencyKey = key, Booking = next });
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return next;
    }
}
