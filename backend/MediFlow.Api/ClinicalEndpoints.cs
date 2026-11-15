using System.Data;
using System.Security.Claims;
using MediFlow.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace MediFlow.Api;

internal static class ClinicalEndpoints
{
    internal static void MapClinical(this RouteGroupBuilder api)
    {
        var doctor = api.MapGroup("/clinical").RequireAuthorization("Doctor");
        var patient = api.MapGroup("/clinical/me").RequireAuthorization("Patient");
        var lab = api.MapGroup("/clinical/lab").RequireAuthorization("LabStaff");

        doctor.MapGet("/visits/{visitId:long}", async (long visitId, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            if (!await HasCare(db, visitId, user, ct)) return Results.NotFound();
            var note = await db.Set<OpdVisitNote>().FindAsync([visitId], ct);
            var requests = await db.Set<OpdLabRequest>().AsNoTracking().Where(item => item.BookingId == visitId)
                .OrderBy(item => item.Id).ToListAsync(ct);
            return Results.Ok(new { note, labRequests = requests });
        });
        doctor.MapPut("/visits/{visitId:long}/note", async (long visitId, NoteInput input, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            if (!Valid(input.Notes, 16000) || (input.Summary is not null && !Valid(input.Summary, 8000))) return Results.BadRequest();
            await using var tx = await Lock(db, ct);
            if (!await HasCare(db, visitId, user, ct)) return Results.NotFound();
            var note = await db.Set<OpdVisitNote>().FindAsync([visitId], ct);
            if (note?.PublishedAt is not null) return Results.Conflict();
            if (note is null)
            {
                note = new OpdVisitNote { BookingId = visitId, Notes = input.Notes!, Summary = input.Summary };
                db.Add(note);
            }
            else
            {
                note.Notes = input.Notes!;
                note.Summary = input.Summary;
            }
            await Save(db, tx, ct);
            return Results.Ok(note);
        });
        doctor.MapPost("/visits/{visitId:long}/publish", async (long visitId, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            await using var tx = await Lock(db, ct);
            if (!await HasCare(db, visitId, user, ct)) return Results.NotFound();
            var note = await db.Set<OpdVisitNote>().FindAsync([visitId], ct);
            if (note?.Summary is null || !await db.OpdBookings.AnyAsync(b => b.Id == visitId && b.Status == OpdBooking.Completed, ct))
                return Results.Conflict();
            note.PublishedAt ??= DateTimeOffset.UtcNow;
            await Save(db, tx, ct);
            return Results.Ok(new { visitId, note.Summary, note.PublishedAt });
        });
        patient.MapGet("/visits", async (ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            var owner = ReceptionEndpoints.UserId(user);
            return await (from note in db.Set<OpdVisitNote>().AsNoTracking()
                          join booking in db.OpdBookings on note.BookingId equals booking.Id
                          where booking.PatientId == owner && note.PublishedAt != null
                          orderby booking.OpdDate descending, booking.TokenNumber
                          select new { visitId = booking.Id, booking.OpdDate, note.Summary, note.PublishedAt }).ToListAsync(ct);
        });

        doctor.MapPost("/visits/{visitId:long}/lab", async (long visitId, LabInput input, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            if (!Valid(input.Test, 160)) return Results.BadRequest();
            await using var tx = await Lock(db, ct);
            if (!await HasCare(db, visitId, user, ct)) return Results.NotFound();
            var request = new OpdLabRequest { BookingId = visitId, Test = input.Test!.Trim() };
            db.Add(request);
            await Save(db, tx, ct);
            return Results.Ok(new { request.Id, request.Test, request.Status });
        });
        lab.MapGet("/worklist", async (MediFlowDbContext db, CancellationToken ct) =>
            await db.Set<OpdLabRequest>().AsNoTracking()
                .Where(item => item.Status == "Requested" || item.Status == "Entered")
                .OrderBy(item => item.Id)
                .Select(item => new { item.Id, item.Test, item.Status, item.Result }).ToListAsync(ct));
        lab.MapPut("/{id:long}/result", async (long id, ResultInput input, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            if (!Valid(input.Result, 8000)) return Results.BadRequest();
            await using var tx = await Lock(db, ct);
            var request = await db.Set<OpdLabRequest>().FindAsync([id], ct);
            if (request is null) return Results.NotFound();
            if (request.Status == "Entered" && request.Result == input.Result && request.EnteredBy == ReceptionEndpoints.UserId(user))
                return Results.Ok(new { request.Id, request.Status });
            if (request.Status != "Requested") return Results.Conflict();
            request.Result = input.Result;
            request.EnteredBy = ReceptionEndpoints.UserId(user);
            request.Status = "Entered";
            await Save(db, tx, ct);
            return Results.Ok(new { request.Id, request.Status });
        });
        lab.MapPost("/{id:long}/verify", async (long id, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            await using var tx = await Lock(db, ct);
            var request = await db.Set<OpdLabRequest>().FindAsync([id], ct);
            if (request is null) return Results.NotFound();
            if (request.Status is "Verified" or "Published") return Results.Ok(new { request.Id, request.Status });
            if (request.Status != "Entered") return Results.Conflict();
            request.Status = "Verified";
            request.VerifiedBy = ReceptionEndpoints.UserId(user);
            await Save(db, tx, ct);
            return Results.Ok(new { request.Id, request.Status });
        });
        doctor.MapPost("/lab/{id:long}/publish", async (long id, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            await using var tx = await Lock(db, ct);
            var request = await db.Set<OpdLabRequest>().FindAsync([id], ct);
            if (request is null || !await HasCare(db, request.BookingId, user, ct)) return Results.NotFound();
            if (request.Status is not ("Verified" or "Published")) return Results.Conflict();
            request.Status = "Published";
            request.PublishedAt ??= DateTimeOffset.UtcNow;
            await Save(db, tx, ct);
            return Results.Ok(new { request.Id, request.Status, request.PublishedAt });
        });
        patient.MapGet("/lab", async (ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            var owner = ReceptionEndpoints.UserId(user);
            return await (from result in db.Set<OpdLabRequest>().AsNoTracking()
                          join booking in db.OpdBookings on result.BookingId equals booking.Id
                          where booking.PatientId == owner && result.Status == "Published"
                          orderby result.Id
                          select new { result.Id, result.Test, result.Result, result.PublishedAt }).ToListAsync(ct);
        });

        doctor.MapPost("/slots", async (SlotInput input, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            var start = input.StartsAt.ToUniversalTime();
            if (start <= DateTimeOffset.UtcNow || start.Ticks % TimeSpan.TicksPerMinute != 0 || input.Capacity is < 1 or > 100)
                return Results.BadRequest();
            var actor = ReceptionEndpoints.UserId(user);
            await using var tx = await Lock(db, ct);
            var slot = await db.Set<OpdAppointmentSlot>().SingleOrDefaultAsync(item => item.DoctorId == actor && item.StartsAt == start, ct);
            if (slot is not null) return slot.Capacity == input.Capacity ? Results.Ok(slot) : Results.Conflict();
            slot = new OpdAppointmentSlot { DoctorId = actor, StartsAt = start, Capacity = input.Capacity };
            db.Add(slot);
            await Save(db, tx, ct);
            return Results.Ok(slot);
        });
        doctor.MapPost("/visits/{visitId:long}/follow-up/{slotId:long}", async (long visitId, long slotId, ClaimsPrincipal user,
            MediFlowDbContext db, CancellationToken ct) =>
        {
            await using var tx = await Lock(db, ct);
            var actor = ReceptionEndpoints.UserId(user);
            var visit = await db.OpdBookings.AsNoTracking().SingleOrDefaultAsync(item => item.Id == visitId &&
                item.DoctorId == actor && item.Status == OpdBooking.Completed && item.PatientId != null, ct);
            var slot = await db.Set<OpdAppointmentSlot>().FindAsync([slotId], ct);
            if (visit is null || slot is null || slot.DoctorId != actor) return Results.NotFound();
            var appointments = db.Set<OpdAppointment>().Where(item => item.SlotId == slotId);
            var appointment = await appointments.SingleOrDefaultAsync(item => item.PatientId == visit.PatientId, ct);
            if (appointment is not null) return Results.Ok(Appointment(appointment));
            if (slot.StartsAt <= DateTimeOffset.UtcNow || await appointments.CountAsync(ct) >= slot.Capacity) return Results.Conflict();
            appointment = new OpdAppointment { Slot = slot, PatientId = visit.PatientId!.Value, VisitId = visitId };
            db.Add(appointment);
            db.Add(new OpdNotification { PatientId = appointment.PatientId, Kind = "AppointmentReminder",
                AppointmentAt = slot.StartsAt, DueAt = slot.StartsAt.AddHours(-24) });
            await Save(db, tx, ct);
            return Results.Ok(Appointment(appointment));
        });
        patient.MapGet("/appointments", async (ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
            await OwnAppointments(db, ReceptionEndpoints.UserId(user)).ToListAsync(ct));
    }

    internal static IQueryable<PatientAppointment> OwnAppointments(MediFlowDbContext db, int owner) =>
        db.Set<OpdAppointment>().AsNoTracking().Where(item => item.PatientId == owner)
            .OrderBy(item => item.Slot.StartsAt)
            .Select(item => new PatientAppointment(item.Id, item.SlotId, item.Slot.StartsAt, item.Slot.DoctorId));

    private static PatientAppointment Appointment(OpdAppointment item) =>
        new(item.Id, item.SlotId, item.Slot.StartsAt, item.Slot.DoctorId);

    private static Task<bool> HasCare(MediFlowDbContext db, long visit, ClaimsPrincipal user, CancellationToken ct)
    {
        var doctor = ReceptionEndpoints.UserId(user);
        return db.OpdBookings.AnyAsync(item => item.Id == visit && item.DoctorId == doctor &&
            (item.Status == OpdBooking.InConsultation || item.Status == OpdBooking.Completed), ct);
    }

    private static bool Valid(string? value, int limit) => !string.IsNullOrWhiteSpace(value) && value.Length <= limit;

    private static async Task<IDbContextTransaction> Lock(MediFlowDbContext db, CancellationToken ct)
    {
        var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try
        {
            await OpdBooking.LockQueueAsync(db, ct);
            return tx;
        }
        catch
        {
            await tx.DisposeAsync();
            throw;
        }
    }

    private static async Task Save(MediFlowDbContext db, IDbContextTransaction tx, CancellationToken ct)
    {
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    private sealed record NoteInput(string? Notes, string? Summary);
    private sealed record LabInput(string? Test);
    private sealed record ResultInput(string? Result);
    private sealed record SlotInput(DateTimeOffset StartsAt, int Capacity);
}

internal sealed record PatientAppointment(long Id, long SlotId, DateTimeOffset StartsAt, int DoctorId);
