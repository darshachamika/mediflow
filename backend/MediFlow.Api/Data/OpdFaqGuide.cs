namespace MediFlow.Api.Data;

public sealed class OpdFaqGuide
{
    public int Id { get; init; }
    public required string Title { get; init; }
    public required string Text { get; init; }
    public required string Keywords { get; init; }
    public const string Source = "Synthetic MediFlow demo guide";
}
