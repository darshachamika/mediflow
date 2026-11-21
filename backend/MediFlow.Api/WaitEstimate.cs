namespace MediFlow.Api;

internal static class WaitEstimate
{
    internal static int? Minutes(int ahead, int rooms, int busyRooms, double duration) =>
        rooms <= 0 ? null : (int)Math.Ceiling(((long)ahead + busyRooms) / rooms * duration);
}
