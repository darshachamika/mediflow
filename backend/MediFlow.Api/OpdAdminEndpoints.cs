using System.Data;
using System.Security.Claims;
using MediFlow.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api;

internal static class OpdAdminEndpoints
{
    internal static void MapOpdAdministration(this RouteGroupBuilder api)
    {
        var admin = api.MapGroup("/opd/admin").RequireAuthorization("OpdAdmin");
        admin.MapGet("/departments", async (MediFlowDbContext db, CancellationToken ct) =>
            await db.Set<OpdDepartment>().AsNoTracking().OrderBy(item => item.Name).ToListAsync(ct));
        admin.MapGet("/rooms", async (MediFlowDbContext db, CancellationToken ct) =>
            await db.Set<OpdRoom>().AsNoTracking().OrderBy(item => item.Name).ToListAsync(ct));
        admin.MapGet("/assignments", async (MediFlowDbContext db, CancellationToken ct) =>
        {
            var today = OpdBooking.Today();
            return await db.Set<OpdAssignment>().AsNoTracking().Where(item => item.OpdDate >= today)
                .OrderBy(item => item.OpdDate).ThenBy(item => item.RoomId)
                .Select(item => new { item.OpdDate, item.RoomId, item.DoctorId }).ToListAsync(ct);
        });
        admin.MapGet("/counts", async (MediFlowDbContext db, CancellationToken ct) =>
        {
            var today = OpdBooking.Today();
            var counts = await db.OpdBookings.AsNoTracking().Where(item => item.OpdDate == today)
                .GroupBy(item => item.Status).Select(group => new { status = group.Key, count = group.Count() }).ToListAsync(ct);
            return Results.Ok(new { opdDate = today, counts });
        });
        admin.MapPost("/departments", async (NameInput input, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            var name = input.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 80) return Results.BadRequest();
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await OpdBooking.LockQueueAsync(db, ct);
            var department = await db.Set<OpdDepartment>().SingleOrDefaultAsync(item => item.Name == name, ct);
            if (department is not null) return Results.Ok(department);
            department = new OpdDepartment { Name = name };
            db.Add(department);
            Audit(db, user, "CreateDepartment", name);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Ok(department);
        });
        admin.MapPost("/rooms", async (RoomInput input, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            var name = input.Name?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > 80) return Results.BadRequest();
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await OpdBooking.LockQueueAsync(db, ct);
            if (!await db.Set<OpdDepartment>().AnyAsync(item => item.Id == input.DepartmentId, ct)) return Results.BadRequest();
            var room = await db.Set<OpdRoom>().SingleOrDefaultAsync(item => item.Name == name, ct);
            if (room is not null) return room.DepartmentId == input.DepartmentId ? Results.Ok(room) : Results.Conflict();
            room = new OpdRoom { Name = name, DepartmentId = input.DepartmentId };
            db.Add(room);
            Audit(db, user, "CreateRoom", name);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Ok(room);
        });
        admin.MapPost("/assignments", async (AssignmentInput input, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await OpdBooking.LockQueueAsync(db, ct);
            if (input.OpdDate < OpdBooking.Today()) return Results.BadRequest();
            var room = await db.Set<OpdRoom>().FindAsync([input.RoomId], ct);
            if (room is null || !room.Active || !await db.AppUsers.AnyAsync(item => item.Id == input.DoctorId && item.Role == "Doctor", ct))
                return Results.BadRequest();
            var assignments = db.Set<OpdAssignment>().Where(item => item.OpdDate == input.OpdDate);
            if (await assignments.AnyAsync(item => item.RoomId == input.RoomId && item.DoctorId == input.DoctorId, ct))
                return Results.Ok(input);
            if (await assignments.AnyAsync(item => item.RoomId == input.RoomId || item.DoctorId == input.DoctorId, ct))
                return Results.Conflict(new { error = "The room or doctor is already assigned for this date." });
            db.Add(new OpdAssignment { Room = room, DoctorId = input.DoctorId, OpdDate = input.OpdDate });
            Audit(db, user, "AssignDoctor", $"{input.OpdDate:yyyy-MM-dd}/{input.RoomId}/{input.DoctorId}");
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.Ok(input);
        });
        api.MapGet("/opd/notifications", async (ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            var owner = ReceptionEndpoints.UserId(user);
            return await db.Set<OpdNotification>().AsNoTracking().Where(item => item.PatientId == owner && item.DeliveredAt != null)
                .OrderByDescending(item => item.Id).Take(100)
                .Select(item => new { item.Id, item.Kind, item.TokenNumber, item.AppointmentAt, item.DeliveredAt,
                    smsDelivery = "Simulated" }).ToListAsync(ct);
        }).RequireAuthorization("Patient");
    }

    private static void Audit(MediFlowDbContext db, ClaimsPrincipal user, string action, string subject) =>
        db.Add(new OpdAdminEvent { ActorId = ReceptionEndpoints.UserId(user), Action = action, Subject = subject, At = DateTimeOffset.UtcNow });

    private sealed record NameInput(string? Name);
    private sealed record RoomInput(string? Name, int DepartmentId);
    private sealed record AssignmentInput(int RoomId, int DoctorId, DateOnly OpdDate);
}
