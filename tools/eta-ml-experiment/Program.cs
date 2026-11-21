using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using MediFlow.Api;
using Microsoft.ML;
using Microsoft.ML.Trainers;

try
{
    if (args.Length == 1 && args[0] == "--self-test") return SelfTest.Run();
    if (args.Length < 2 || (args[0] != "--synthetic" && args[0] != "--csv"))
        throw new InvalidDataException("Usage: --synthetic OUTPUT_DIRECTORY | --csv INPUT.csv OUTPUT_DIRECTORY | --self-test");
    var synthetic = args[0] == "--synthetic";
    if (args.Length != (synthetic ? 2 : 3)) throw new InvalidDataException("Unexpected arguments.");
    var output = args[^1];
    var rows = (synthetic ? SyntheticRows() : ReadCsv(args[1])).OrderBy(row => row.ObservedAt).ToArray();
    if (rows.Length < 20) throw new InvalidDataException("At least 20 eligible observations are required to evaluate.");
    var days = rows.Select(row => row.Day).Distinct().Order().ToArray();
    if (days.Length < 3) throw new InvalidDataException("At least three separate OPD dates are required.");
    var cutoff = days[Math.Clamp((int)(days.Length * .8), 1, days.Length - 1)];
    var cutoffUtc = new DateTimeOffset(cutoff.ToDateTime(TimeOnly.MinValue), TimeSpan.FromMinutes(330));
    var train = rows.Where(row => row.Day < cutoff && row.CalledAt < cutoffUtc).ToArray();
    var test = rows.Where(row => row.Day >= cutoff).ToArray();
    if (train.Length < 10 || test.Length < 4) throw new InvalidDataException("Insufficient rows in the chronological partitions.");

    var ml = new MLContext(seed: 2026);
    var trainingData = ml.Data.LoadFromEnumerable(train.Select(Features));
    var pipeline = ml.Transforms.Concatenate("Features", nameof(EtaFeatures.Ahead), nameof(EtaFeatures.Rooms),
            nameof(EtaFeatures.Busy), nameof(EtaFeatures.Duration), nameof(EtaFeatures.Baseline))
        .Append(ml.Transforms.NormalizeMeanVariance("Features"))
        .Append(ml.Regression.Trainers.Sdca(new SdcaRegressionTrainer.Options
        {
            LabelColumnName = nameof(EtaFeatures.Label), MaximumNumberOfIterations = 200,
            NumberOfThreads = 1, Shuffle = false
        }));
    var model = pipeline.Fit(trainingData);
    var featureRows = test.Select(Features).ToArray();
    var scores = ml.Data.CreateEnumerable<EtaScore>(model.Transform(ml.Data.LoadFromEnumerable(featureRows)), false).ToArray();
    var baseline = Metrics(featureRows.Select(row => (double)row.Baseline - row.Label));
    // Score the same rounded, bounded estimator that will be used by the API.
    var candidate = Metrics(featureRows.Zip(scores).Select(pair =>
        (double.IsFinite(pair.Second.Score) && pair.Second.Score >= 0 && pair.Second.Score <= 1440
            ? Math.Ceiling(pair.Second.Score) : pair.First.Baseline) - pair.First.Label));
    var trainPartition = Partition(train);
    var testPartition = Partition(test);
    var accepted = scores.All(score => float.IsFinite(score.Score) && score.Score >= 0 && score.Score <= 1440)
        && EtaModelMetadata.MeetsCriteria(trainPartition, testPartition, baseline, candidate);
    Directory.CreateDirectory(output);
    var modelPath = Path.Combine(output, "model.zip");
    ml.Model.Save(model, trainingData.Schema, modelPath);
    using (var archive = ZipFile.Open(modelPath, ZipArchiveMode.Update))
        foreach (var entry in archive.Entries)
            entry.LastWriteTime = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
    var inputFingerprint = JsonSerializer.Serialize(rows);
    var version = "eta-v1-" + Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(inputFingerprint)))[..16];
    var metadata = new EtaModelMetadata(version, EtaModelMetadata.CurrentSchema, synthetic ? "Synthetic" : "Operational",
        Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(modelPath))), trainPartition, testPartition,
        baseline, candidate, accepted);
    var json = JsonSerializer.Serialize(metadata, new JsonSerializerOptions { WriteIndented = true });
    File.WriteAllText(Path.Combine(output, "metadata.json"), json);
    Console.WriteLine(json);
    Console.WriteLine(synthetic ? "Synthetic demonstration only. Operational activation is blocked." : "Review provenance and representativeness before explicit activation.");
    return 0;
}
catch (Exception error) when (error is IOException or InvalidDataException or FormatException or OverflowException or ArgumentException)
{
    Console.Error.WriteLine(error.Message);
    return 1;
}

static EtaPartition Partition(Visit[] rows) => new(rows.Length, rows.Min(row => row.Day), rows.Max(row => row.Day));
static EtaMetrics Metrics(IEnumerable<double> differences)
{
    var errors = differences.ToArray();
    return new(errors.Average(Math.Abs), Math.Sqrt(errors.Average(value => value * value)));
}
static EtaFeatures Features(Visit row)
{
    var features = EtaFeatures.From(row.WaitingAhead, row.ServingRooms, row.BusyRooms, row.ConsultationMinutes);
    features.Label = (float)(row.CalledAt - row.ObservedAt).TotalMinutes;
    return features;
}

static IEnumerable<Visit> SyntheticRows()
{
    var random = new Random(2026);
    var start = new DateTimeOffset(2026, 1, 1, 8, 0, 0, TimeSpan.FromMinutes(330));
    for (var day = 0; day < 60; day++)
    {
        for (var i = 0; i < 20; i++)
        {
            var observed = start.AddDays(day).AddMinutes(i * 15);
            var rooms = random.Next(1, 5);
            var busy = random.Next(rooms + 1);
            var ahead = random.Next(2, 14);
            var duration = random.Next(7, 18);
            var baseline = WaitEstimate.Minutes(ahead, rooms, busy, duration)!.Value;
            var minutes = Math.Max(0, baseline * .75 + 2 + random.NextDouble() * 2);
            yield return new(observed, observed.AddMinutes(minutes), ahead, rooms, busy, duration);
        }
    }
}

static IEnumerable<Visit> ReadCsv(string path)
{
    using var reader = File.OpenText(path);
    const string header = "observedAt,calledAt,waitingAhead,servingRooms,busyRooms,consultationMinutes";
    if (reader.ReadLine() != header) throw new InvalidDataException("Unexpected CSV header. Use the current export.sql.");
    var number = 1;
    while (reader.ReadLine() is { } line)
    {
        number++;
        var values = line.Split(',');
        if (values.Length != 6
            || !DateTimeOffset.TryParse(values[0], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var observed)
            || !DateTimeOffset.TryParse(values[1], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var called)
            || !int.TryParse(values[2], out var ahead) || !int.TryParse(values[3], out var rooms)
            || !int.TryParse(values[4], out var busy)
            || !double.TryParse(values[5], NumberStyles.Float, CultureInfo.InvariantCulture, out var duration)
            || called < observed || (called - observed).TotalMinutes > 1440
            || !EtaFeatures.From(ahead, rooms, busy, duration).Valid)
            throw new InvalidDataException($"Invalid dataset row {number}.");
        yield return new(observed, called, ahead, rooms, busy, duration);
    }
}
internal sealed record Visit(DateTimeOffset ObservedAt, DateTimeOffset CalledAt, int WaitingAhead,
    int ServingRooms, int BusyRooms, double ConsultationMinutes)
{
    public DateOnly Day => DateOnly.FromDateTime(ObservedAt.ToOffset(TimeSpan.FromMinutes(330)).DateTime);
}
