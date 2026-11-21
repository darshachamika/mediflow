namespace MediFlow.Api.Data;

public sealed class OpdEstimateSample
{
    public long BookingId { get; init; }
    public required OpdBooking Booking { get; init; }
    public DateTimeOffset ObservedAt { get; init; }
    public int WaitingAhead { get; init; }
    public int ServingRooms { get; init; }
    public int BusyRooms { get; init; }
    public double ConsultationMinutes { get; init; }
    public bool UsesFallback { get; init; }
}
