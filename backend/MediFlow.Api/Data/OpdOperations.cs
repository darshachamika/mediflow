namespace MediFlow.Api.Data;

public sealed class OpdDepartment
{
    public int Id { get; init; }
    public required string Name { get; init; }
}

public sealed class OpdAdminEvent
{
    public long Id { get; init; }
    public int ActorId { get; init; }
    public required string Action { get; init; }
    public required string Subject { get; init; }
    public DateTimeOffset At { get; init; }
}

public sealed class OpdNotification
{
    public long Id { get; init; }
    public int PatientId { get; init; }
    public required string Kind { get; init; }
    public int? TokenNumber { get; init; }
    public DateTimeOffset? AppointmentAt { get; init; }
    public DateTimeOffset DueAt { get; set; }
    public int Attempts { get; set; }
    public DateTimeOffset? DeliveredAt { get; set; }
    public DateTimeOffset? FailedAt { get; set; }

    public static void EnqueueCall(MediFlowDbContext db, OpdBooking booking)
    {
        if (booking.PatientId is int patient)
            db.Add(new OpdNotification { PatientId = patient, Kind = "TokenCalled",
                TokenNumber = booking.TokenNumber, DueAt = DateTimeOffset.UtcNow });
    }
}
