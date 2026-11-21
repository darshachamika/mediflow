namespace MediFlow.Api.Data;

public sealed class OpdCheckIn
{
    public long BookingId { get; init; }
    public required OpdBooking Booking { get; init; }
    public int StaffId { get; init; }
    public required string Method { get; init; }
    public DateTimeOffset JoinedAt { get; init; }
}
