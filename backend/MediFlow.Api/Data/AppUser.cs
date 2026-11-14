namespace MediFlow.Api.Data;

public sealed class AppUser
{
    public int Id { get; init; }
    public required string FirebaseUid { get; init; }
    public required string Role { get; init; }
}
