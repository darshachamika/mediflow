using System.Security.Claims;
using System.Text.Json;
using MediFlow.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace MediFlow.Api;

internal static class OpdAssistantEndpoints
{
    internal static void MapAssistant(this RouteGroupBuilder api)
    {
        var patient = api.MapGroup("/opd/assistant").RequireAuthorization("Patient");
        patient.MapPost("/query", async (AssistantInput input, ClaimsPrincipal user, MediFlowDbContext db,
            IFaqProvider provider, IConfiguration config, CancellationToken ct) =>
        {
            var owner = ReceptionEndpoints.UserId(user);
            switch (input.Kind)
            {
                case "tokens":
                    var today = OpdBooking.Today();
                    var tokens = await OpdBooking.OwnBookings(db, owner, today, today).ToListAsync(ct);
                    return Results.Ok(new { kind = input.Kind, opdDate = today, items = tokens });
                case "appointments":
                    var appointments = await ClinicalEndpoints.OwnAppointments(db, owner).ToListAsync(ct);
                    return Results.Ok(new { kind = input.Kind, items = appointments });
                case "faq":
                    if (string.IsNullOrWhiteSpace(input.Question) || input.Question.Length > 500) return Results.BadRequest();
                    return Results.Ok(await Faq(db, provider, config, input.Question, ct));
                default:
                    return Results.BadRequest(new { error = "Choose faq, tokens, or appointments." });
            }
        });

        api.MapPost("/opd/admin/faq/index", async (MediFlowDbContext db, IFaqProvider provider, IConfiguration config, CancellationToken ct) =>
        {
            if (!config.GetValue<bool>("OpdFaq:VectorEnabled")) return Results.Conflict(new { error = "FAQ vector retrieval is disabled." });
            var guides = await db.Set<OpdFaqGuide>().AsNoTracking().OrderBy(guide => guide.Id).ToListAsync(ct);
            var vectors = new List<(int Id, string Vector)>();
            try
            {
                foreach (var guide in guides)
                    vectors.Add((guide.Id, OpdFaq.Vector(await provider.Embed(guide.Title + " " + guide.Keywords + " " + guide.Text, ct))));
                await using var tx = await db.Database.BeginTransactionAsync(ct);
                foreach (var vector in vectors)
                    await db.Database.ExecuteSqlInterpolatedAsync($"""
                        INSERT INTO opd_faq_vectors (guide_id, model, embedding)
                        VALUES ({vector.Id}, {provider.EmbeddingModel}, CAST({vector.Vector} AS vector))
                        ON CONFLICT (guide_id, model) DO UPDATE SET embedding = excluded.embedding
                        """, ct);
                await tx.CommitAsync(ct);
                return Results.Ok(new { indexed = vectors.Count, source = OpdFaqGuide.Source });
            }
            catch (Exception error) when (Unavailable(error, ct))
            {
                return Results.Problem("FAQ indexing is unavailable. Verify pgvector setup and provider configuration.", statusCode: 503);
            }
        }).RequireAuthorization("OpdAdmin");
    }

    private static async Task<object> Faq(MediFlowDbContext db, IFaqProvider provider, IConfiguration config,
        string question, CancellationToken ct)
    {
        const string fallback = "The demo guides do not answer that question. Contact OPD reception for help.";
        List<OpdFaqGuide> guides;
        var retrieval = "Keywords";
        if (config.GetValue<bool>("OpdFaq:VectorEnabled"))
        {
            try
            {
                guides = await OpdFaq.Retrieve(db, provider, question, ct);
                retrieval = "Pgvector";
            }
            catch (Exception error) when (Unavailable(error, ct))
            {
                guides = await KeywordGuides(db, question, ct);
            }
        }
        else guides = await KeywordGuides(db, question, ct);

        var questionWords = OpdFaq.Words(question).ToHashSet(StringComparer.Ordinal);
        guides = guides.Where(guide => OpdFaq.Words(guide.Keywords).Any(questionWords.Contains)).ToList();
        if (guides.Count == 0)
            return new { kind = "faq", answer = fallback, grounded = false, retrieval, sources = Array.Empty<object>() };
        string? answer;
        try { answer = await provider.Answer(question, guides, ct); }
        catch (Exception error) when (Unavailable(error, ct)) { answer = guides[0].Text; }
        if (string.IsNullOrWhiteSpace(answer) || answer.Trim().Equals("UNSUPPORTED", StringComparison.OrdinalIgnoreCase))
            return new { kind = "faq", answer = fallback, grounded = false, retrieval, sources = Array.Empty<object>() };
        return new { kind = "faq", answer, grounded = true, retrieval,
            sources = guides.Select(guide => new { guide.Id, guide.Title, source = OpdFaqGuide.Source }).ToArray() };
    }

    private static async Task<List<OpdFaqGuide>> KeywordGuides(MediFlowDbContext db, string question, CancellationToken ct)
    {
        var words = OpdFaq.Words(question).ToHashSet(StringComparer.Ordinal);
        var guides = await db.Set<OpdFaqGuide>().AsNoTracking().ToListAsync(ct);
        return guides.Select(guide => new { Guide = guide, Hits = OpdFaq.Words(guide.Keywords).Count(words.Contains) })
            .Where(item => item.Hits > 0).OrderByDescending(item => item.Hits).ThenBy(item => item.Guide.Id)
            .Take(3).Select(item => item.Guide).ToList();
    }

    private static bool Unavailable(Exception error, CancellationToken ct) => !ct.IsCancellationRequested
        && error is HttpRequestException or OperationCanceledException or JsonException or KeyNotFoundException
            or InvalidOperationException or NpgsqlException or FormatException or IndexOutOfRangeException;

    private sealed record AssistantInput(string? Kind, string? Question);
}
