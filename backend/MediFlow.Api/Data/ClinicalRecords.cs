namespace MediFlow.Api.Data;

public sealed class OpdVisitNote
{
    public long BookingId { get; init; }
    public required string Notes { get; set; }
    public string? Summary { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
}

public sealed class OpdLabRequest
{
    public long Id { get; init; }
    public long BookingId { get; init; }
    public required string Test { get; init; }
    public string Status { get; set; } = "Requested";
    public string? Result { get; set; }
    public int? EnteredBy { get; set; }
    public int? VerifiedBy { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
}

public sealed class OpdAppointmentSlot
{
    public long Id { get; init; }
    public int DoctorId { get; init; }
    public DateTimeOffset StartsAt { get; init; }
    public int Capacity { get; init; }
}

public sealed class OpdAppointment
{
    public long Id { get; init; }
    public long SlotId { get; init; }
    public required OpdAppointmentSlot Slot { get; init; }
    public int PatientId { get; init; }
    public long VisitId { get; init; }
}
