using System.Globalization;
using MediFlow.Api;
using Microsoft.ML;

if (args.Length != 0 && (args.Length != 2 || args[0] != "--csv"))
{
    Console.Error.WriteLine("Usage: EtaExperiment [--csv dataset.csv]");
    return 2;
}

try
{
    var synthetic = args.Length == 0;
    var rows = (synthetic ? SyntheticRows() : ReadCsv(args[1]))
        .Where(row => row.ServingRooms > 0)
        .OrderBy(row => row.ObservedAt).ToArray();
    if (rows.Length < 20) throw new InvalidDataException("At least 20 completed visits with serving rooms are required.");
    var cutoff = rows[(int)(rows.Length * 0.8)].ObservedAt;
    var train = rows.Where(row => row.ObservedAt < cutoff && row.StartedAt < cutoff).ToArray();
    var test = rows.Where(row => row.ObservedAt >= cutoff).ToArray();
    if (train.Length < 10 || test.Length < 4)
        throw new InvalidDataException("The chronological split must have at least 10 training visits and 4 held-out visits.");

    var ml = new MLContext(seed: 2026);
    var trainingData = ml.Data.LoadFromEnumerable(train.Select(Features));
    var pipeline = ml.Transforms.Concatenate("Features", nameof(Observation.Ahead), nameof(Observation.Rooms),
            nameof(Observation.Busy), nameof(Observation.Duration), nameof(Observation.Fallback), nameof(Observation.Baseline))
        .Append(ml.Transforms.NormalizeMeanVariance("Features"))
        .Append(ml.Regression.Trainers.Sdca(labelColumnName: nameof(Observation.Label), maximumNumberOfIterations: 100));
    var model = pipeline.Fit(trainingData);
    var testFeatures = test.Select(Features).ToArray();
    var predictions = ml.Data.CreateEnumerable<Prediction>(
        model.Transform(ml.Data.LoadFromEnumerable(testFeatures)), reuseRowObject: false).ToArray();

    var baselineMae = testFeatures.Average(row => Math.Abs(row.Baseline - row.Label));
    var mlMae = testFeatures.Zip(predictions).Average(pair => Math.Abs(Math.Max(0, pair.Second.Score) - pair.First.Label));
    if (!double.IsFinite(mlMae)) throw new InvalidDataException("Experiment returned a non-finite error.");

    Console.WriteLine(synthetic ? "Synthetic pipeline demonstration. Results are not clinical validation." : "Supplied dataset. Review representativeness before using a model.");
    Console.WriteLine($"Chronological cutoff (UTC): {cutoff:O}. Training rows: {train.Length}. Held-out rows: {test.Length}.");
    Console.WriteLine(FormattableString.Invariant($"Held-out MAE (minutes): C# baseline {baselineMae:F2}, ML.NET {mlMae:F2}."));
    Console.WriteLine("The live API continues using the C# baseline.");
    return 0;
}
catch (Exception error) when (error is IOException or InvalidDataException or FormatException or OverflowException)
{
    Console.Error.WriteLine(error.Message);
    return 1;
}

static Observation Features(Visit row) => new()
{
    Ahead = row.WaitingAhead,
    Rooms = row.ServingRooms,
    Busy = row.BusyRooms,
    Duration = (float)row.ConsultationMinutes,
    Fallback = row.UsesFallback ? 1 : 0,
    Baseline = WaitEstimate.Minutes(row.WaitingAhead, row.ServingRooms, row.BusyRooms, row.ConsultationMinutes)!.Value,
    Label = (float)(row.StartedAt - row.ObservedAt).TotalMinutes
};

static IEnumerable<Visit> SyntheticRows()
{
    var random = new Random(2026);
    var start = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
    for (var index = 0; index < 500; index++)
    {
        var observed = start.AddMinutes(index * 17);
        var rooms = random.Next(1, 5);
        var busy = random.Next(rooms + 1);
        var ahead = random.Next(14);
        var duration = random.Next(7, 18);
        var minutes = Math.Max(0, ((double)ahead + busy) / rooms * duration + random.NextDouble() * 8 - 4);
        yield return new Visit(observed, observed.AddMinutes(minutes), ahead, rooms, busy, duration, index % 7 == 0);
    }
}

static IEnumerable<Visit> ReadCsv(string path)
{
    using var reader = File.OpenText(path);
    const string header = "observedAt,startedAt,waitingAhead,servingRooms,busyRooms,consultationMinutes,usesFallback";
    if (reader.ReadLine() != header) throw new InvalidDataException($"Expected the CSV header {header}");
    var lineNumber = 1;
    while (reader.ReadLine() is { } line)
    {
        lineNumber++;
        var values = line.Split(',');
        if (values.Length != 7
            || !DateTimeOffset.TryParse(values[0], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var observed)
            || !DateTimeOffset.TryParse(values[1], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var started)
            || !int.TryParse(values[2], out var ahead) || !int.TryParse(values[3], out var rooms)
            || !int.TryParse(values[4], out var busy)
            || !double.TryParse(values[5], NumberStyles.Float, CultureInfo.InvariantCulture, out var duration)
            || !bool.TryParse(values[6], out var fallback)
            || started < observed || ahead < 0 || rooms < 0 || busy < 0 || busy > rooms
            || !double.IsFinite(duration) || duration is < 1 or > 180)
            throw new InvalidDataException($"Invalid dataset row {lineNumber}.");
        yield return new Visit(observed, started, ahead, rooms, busy, duration, fallback);
    }
}

internal sealed record Visit(DateTimeOffset ObservedAt, DateTimeOffset StartedAt, int WaitingAhead,
    int ServingRooms, int BusyRooms, double ConsultationMinutes, bool UsesFallback);

internal sealed class Observation
{
    public float Ahead { get; init; }
    public float Rooms { get; init; }
    public float Busy { get; init; }
    public float Duration { get; init; }
    public float Fallback { get; init; }
    public float Baseline { get; init; }
    public float Label { get; init; }
}

internal sealed class Prediction
{
    public float Score { get; set; }
}
