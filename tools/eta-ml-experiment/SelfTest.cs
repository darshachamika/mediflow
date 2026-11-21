using System.Text.Json;
using System.Security.Cryptography;
using MediFlow.Api;

internal static class SelfTest
{
    internal static int Run()
    {
        var folder = Path.Combine(Path.GetTempPath(), "mediflow-eta-" + Guid.NewGuid());
        Directory.CreateDirectory(folder);
        try
        {
            Assert(new EtaPredictor(folder, false).State == "Disabled", "disabled");
            Assert(new EtaPredictor(folder, true).Predict(EtaFeatures.From(2, 1, 0, 12)) is null, "missing fallback");
            File.WriteAllText(Path.Combine(folder, "metadata.json"), "invalid");
            Assert(new EtaPredictor(folder, true).State == "Unavailable", "corrupt fallback");
            Assert(!EtaFeatures.From(-1, 1, 0, 12).Valid && !EtaFeatures.From(1, 1, 2, 12).Valid, "invalid input");
            Assert(!EtaFeatures.From(1, 1, 0, double.NaN).Valid, "nonfinite");
            Assert(WaitEstimate.Minutes(1, 0, 0, 12) is null, "no rooms");
            Assert(EtaPredictor.ValidMinutes(float.NaN) is null && EtaPredictor.ValidMinutes(float.PositiveInfinity) is null
                && EtaPredictor.ValidMinutes(-1) is null && EtaPredictor.ValidMinutes(1441) is null, "invalid predictions");
            var artifact = Path.GetFullPath("artifacts/eta/synthetic");
            var metadataPath = Path.Combine(artifact, "metadata.json");
            if (!File.Exists(metadataPath)) throw new InvalidDataException("Train --synthetic artifacts/eta/synthetic first.");
            var metadata = JsonSerializer.Deserialize<EtaModelMetadata>(File.ReadAllText(metadataPath))!;
            Assert(metadata.Accepted, "synthetic acceptance");
            Assert(new EtaPredictor(artifact, true).Predict(EtaFeatures.From(4, 2, 1, 12)) is null, "synthetic operational block");
            var predictor = new EtaPredictor(artifact, true, allowSynthetic: true);
            Assert(predictor.State == "Ready", "model loaded");
            var expected = predictor.Predict(EtaFeatures.From(4, 2, 1, 12));
            Assert(expected.HasValue && expected >= 0, "valid prediction");
            Parallel.For(0, 100, _ => Assert(predictor.Predict(EtaFeatures.From(4, 2, 1, 12)) == expected, "concurrent predictions"));
            File.Copy(Path.Combine(artifact, "model.zip"), Path.Combine(folder, "model.zip"));
            File.WriteAllText(Path.Combine(folder, "metadata.json"), JsonSerializer.Serialize(metadata with { FeatureSchema = 99 }));
            Assert(new EtaPredictor(folder, true, true).State == "Unavailable", "incompatible fallback");
            File.WriteAllText(Path.Combine(folder, "metadata.json"), JsonSerializer.Serialize(metadata));
            File.WriteAllText(Path.Combine(folder, "model.zip"), "damaged");
            Assert(new EtaPredictor(folder, true, true).State == "Unavailable", "hash fallback");
            var brokenHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(folder, "model.zip"))));
            File.WriteAllText(Path.Combine(folder, "metadata.json"), JsonSerializer.Serialize(metadata with { ModelSha256 = brokenHash }));
            Assert(new EtaPredictor(folder, true, true).State == "Unavailable", "corrupt model fallback");
            File.Copy(Path.Combine(artifact, "model.zip"), Path.Combine(folder, "model.zip"), overwrite: true);
            File.WriteAllText(Path.Combine(folder, "metadata.json"), JsonSerializer.Serialize(metadata with { Accepted = false }));
            Assert(new EtaPredictor(folder, true, true).State == "Unavailable", "unaccepted fallback");
            Assert(metadata.Training.LastDay < metadata.Evaluation.FirstDay, "day isolation");
            Console.WriteLine("PASS ML loading, metadata/schema/hash validation, synthetic activation block, invalid features, no rooms, baseline fallback, and 100 concurrent predictions");
            return 0;
        }
        finally
        {
            foreach (var file in Directory.GetFiles(folder)) File.Delete(file);
            Directory.Delete(folder);
        }
    }
    private static void Assert(bool condition, string description)
    {
        if (!condition) throw new InvalidDataException("Failed " + description);
    }
}
