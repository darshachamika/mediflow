namespace MediFlow.Api.Data;

public sealed class OpdRoom
{
    public int Id { get; init; }
    public required string Name { get; init; }
    public bool Active { get; set; } = true;
    public int? DepartmentId { get; set; }
}

public sealed class OpdAssignment
{
    public int RoomId { get; init; }
    public required OpdRoom Room { get; init; }
    public int DoctorId { get; init; }
    public DateOnly OpdDate { get; init; }
}

public sealed class OpdRoomCall
{
    public int DoctorId { get; init; }
    public required string Key { get; init; }
    public int RoomId { get; init; }
    public long? BookingId { get; init; }
    public int? TokenNumber { get; init; }
    public DateOnly OpdDate { get; init; }
    public DateTimeOffset? CalledAt { get; init; }
}

public sealed class OpdQueueEvent
{
    public long Id { get; init; }
    public long BookingId { get; init; }
    public int ActorId { get; init; }
    public required string Action { get; init; }
    public DateTimeOffset At { get; init; }
}
