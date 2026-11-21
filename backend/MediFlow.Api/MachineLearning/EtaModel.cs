using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.ML;

namespace MediFlow.Api;

public sealed class EtaFeatures
{
    public float Ahead { get; set; }
    public float Rooms { get; set; }
    public float Busy { get; set; }
    public float Duration { get; set; }
    public float Baseline { get; set; }
    public float Label { get; set; }

    public bool Valid => float.IsFinite(Ahead) && Ahead >= 0 && Ahead <= 10000
        && float.IsFinite(Rooms) && Rooms >= 1 && Rooms <= 1000
        && float.IsFinite(Busy) && Busy >= 0 && Busy <= Rooms
        && float.IsFinite(Duration) && Duration >= 1 && Duration <= 180;

    public static EtaFeatures From(int ahead, int rooms, int busy, double duration) => new()
    {
        Ahead = ahead, Rooms = rooms, Busy = busy, Duration = (float)duration,
        Baseline = WaitEstimate.Minutes(ahead, rooms, busy, duration) ?? 0
    };
}

public sealed class EtaScore
{
    public float Score { get; set; }
}

public sealed record EtaMetrics(double Mae, double Rmse);
public sealed record EtaPartition(int Count, DateOnly FirstDay, DateOnly LastDay);
public sealed record EtaModelMetadata(string Version, int FeatureSchema, string DataKind, string ModelSha256,
    EtaPartition Training, EtaPartition Evaluation, EtaMetrics Baseline, EtaMetrics Candidate, bool Accepted)
{
    public const int CurrentSchema = 1;
    public static bool MeetsCriteria(EtaPartition train, EtaPartition test, EtaMetrics baseline, EtaMetrics candidate) =>
        train.Count >= 100 && test.Count >= 30 && train.LastDay < test.FirstDay
        && train.LastDay.DayNumber - train.FirstDay.DayNumber >= 13
        && test.LastDay.DayNumber - test.FirstDay.DayNumber >= 6
        && double.IsFinite(baseline.Mae) && double.IsFinite(baseline.Rmse)
        && double.IsFinite(candidate.Mae) && double.IsFinite(candidate.Rmse)
        && baseline.Mae > 0 && candidate.Mae >= 0 && candidate.Rmse >= 0
        && candidate.Mae <= baseline.Mae * .95 && candidate.Rmse <= baseline.Rmse;
}

// A single immutable artifact is loaded at startup. PredictionEngine is protected because it is not thread safe.
public sealed class EtaPredictor : IDisposable
{
    private readonly object gate = new();
    private readonly PredictionEngine<EtaFeatures, EtaScore>? engine;
    public string? Version { get; }
    public string State { get; } = "Disabled";

    public EtaPredictor(string? directory, bool enabled, bool allowSynthetic = false)
    {
        if (!enabled) return;
        State = "Unavailable";
        try
        {
            if (string.IsNullOrWhiteSpace(directory)) return;
            var metadata = JsonSerializer.Deserialize<EtaModelMetadata>(File.ReadAllText(Path.Combine(directory, "metadata.json")));
            if (metadata is null || metadata.FeatureSchema != EtaModelMetadata.CurrentSchema
                || !metadata.Accepted || string.IsNullOrWhiteSpace(metadata.Version)
                || !EtaModelMetadata.MeetsCriteria(metadata.Training, metadata.Evaluation, metadata.Baseline, metadata.Candidate)
                || (metadata.DataKind != "Operational" && !(allowSynthetic && metadata.DataKind == "Synthetic"))) return;
            var bytes = File.ReadAllBytes(Path.Combine(directory, "model.zip"));
            if (Convert.ToHexString(SHA256.HashData(bytes)) != metadata.ModelSha256) return;
            var ml = new MLContext(seed: 2026);
            using var stream = new MemoryStream(bytes);
            var model = ml.Model.Load(stream, out _);
            var candidate = ml.Model.CreatePredictionEngine<EtaFeatures, EtaScore>(model);
            var probe = candidate.Predict(EtaFeatures.From(1, 1, 0, 12)).Score;
            if (ValidMinutes(probe) is null) return;
            engine = candidate;
            Version = metadata.Version;
            State = "Ready";
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            // All artifact failures fall back to the existing estimator. Never log artifact content or credentials.
            State = "Unavailable";
        }
    }

    public int? Predict(EtaFeatures features)
    {
        if (engine is null || !features.Valid) return null;
        lock (gate)
        {
            try
            {
                var score = engine.Predict(features).Score;
                return ValidMinutes(score);
            }
            catch (Exception error) when (error is not OutOfMemoryException) { return null; }
        }
    }

    public void Dispose() => engine?.Dispose();

    internal static int? ValidMinutes(float score) =>
        float.IsFinite(score) && score >= 0 && score <= 1440 ? (int)Math.Ceiling(score) : null;
}
