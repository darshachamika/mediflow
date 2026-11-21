using Microsoft.EntityFrameworkCore;
using MediFlow.Api.Data;

namespace MediFlow.Api;

internal sealed class OpdNotificationWorker(IServiceScopeFactory scopes, ILogger<OpdNotificationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                for (var count = 0; count < 50 && await Deliver(stoppingToken); count++) { }
            }
            catch (Exception error) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning(error, "OPD notification worker will retry its database operation.");
            }
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }

    private async Task<bool> Deliver(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<MediFlowDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var pending = await db.Set<OpdNotification>().FromSqlRaw("""
            SELECT * FROM opd_notification_outbox
            WHERE "DeliveredAt" IS NULL AND "FailedAt" IS NULL AND "DueAt" <= now()
            ORDER BY "DueAt", "Id" LIMIT 1 FOR UPDATE SKIP LOCKED
            """).ToListAsync(ct);
        if (pending.Count == 0) return false;
        var item = pending[0];
        item.Attempts++;
        var now = DateTimeOffset.UtcNow;
        // The delivered row is the in-app alert and the durable simulated SMS record.
        if ((item.Kind == "TokenCalled" && item.TokenNumber.HasValue)
            || (item.Kind == "AppointmentReminder" && item.AppointmentAt.HasValue))
            item.DeliveredAt = now;
        else if (item.Attempts >= 5)
            item.FailedAt = now;
        else
            item.DueAt = now.AddSeconds(Math.Pow(2, item.Attempts));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        if (item.DeliveredAt.HasValue)
            logger.LogInformation("Recorded simulated SMS for OPD notification {NotificationId}. No SMS was sent.", item.Id);
        else if (item.FailedAt.HasValue)
            logger.LogWarning("OPD notification {NotificationId} exhausted delivery attempts.", item.Id);
        return true;
    }
}
