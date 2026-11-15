using System.Data;
using System.Security.Claims;
using MediFlow.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api;

internal static class DoctorEndpoints
{
    internal static void MapDoctor(this RouteGroupBuilder api, Func<HttpRequest, string?> readKey)
    {
        var doctor = api.MapGroup("/opd/rooms/{roomId:int}").RequireAuthorization("Doctor");
        doctor.MapGet("", async (int roomId, ClaimsPrincipal user, MediFlowDbContext db, CancellationToken ct) =>
        {
            var actor = ReceptionEndpoints.UserId(user);
            var day = OpdBooking.Today();
            if (!await Assigned(db, roomId, actor, day, ct)) return Results.Forbid();
            var booking = await db.OpdBookings.AsNoTracking().SingleOrDefaultAsync(b => b.OpdDate == day
                && b.RoomId == roomId && b.DoctorId == actor
                && (b.Status == OpdBooking.Called || b.Status == OpdBooking.InConsultation), ct);
            return Results.Ok(new { roomId, opdDate = day, activeToken = booking is null ? null : PrivateToken(booking) });
        });
        doctor.MapPost("/call-next", async (int roomId, HttpRequest request, ClaimsPrincipal user,
            MediFlowDbContext db, IHubContext<OpdDisplayHub> hub, CancellationToken ct) =>
        {
            var key = readKey(request);
            if (key is null) return Results.BadRequest(new { error = "Supply a valid Idempotency-Key." });
            var actor = ReceptionEndpoints.UserId(user);
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await OpdBooking.LockQueueAsync(db, ct);
            var day = OpdBooking.Today();
            if (!await Assigned(db, roomId, actor, day, ct)) return Results.Forbid();
            var prior = await db.Set<OpdRoomCall>().FindAsync([actor, key], ct);
            if (prior is not null)
                return prior.RoomId == roomId ? Results.Ok(CallResult(prior)) : Results.Conflict();
            if (await db.OpdBookings.AnyAsync(b => b.OpdDate == day && b.RoomId == roomId &&
                (b.Status == OpdBooking.Called || b.Status == OpdBooking.InConsultation), ct))
                return Results.Conflict(new { error = "This room already has an active token." });

            var booking = await OpdBooking.WaitingQueue(db, day).FirstOrDefaultAsync(ct);
            if (booking is not null)
            {
                booking.Status = OpdBooking.Called;
                booking.CalledAt = Now();
                booking.RoomId = roomId;
                booking.DoctorId = actor;
                AddEvent(db, booking, actor, "Called");
                OpdNotification.EnqueueCall(db, booking);
            }
            var call = new OpdRoomCall
            {
                DoctorId = actor, RoomId = roomId, Key = key, BookingId = booking?.Id,
                TokenNumber = booking?.TokenNumber, CalledAt = booking?.CalledAt, OpdDate = day
            };
            db.Add(call);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            if (booking is not null) await Publish(db, hub, booking);
            return Results.Ok(CallResult(call));
        });

        doctor.MapPost("/tokens/{bookingId:long}/{action}", async (int roomId, long bookingId, string action,
            ClaimsPrincipal user, MediFlowDbContext db, IHubContext<OpdDisplayHub> hub, CancellationToken ct) =>
        {
            var transition = action switch
            {
                "start" => (OpdBooking.Called, OpdBooking.InConsultation),
                "complete" => (OpdBooking.InConsultation, OpdBooking.Completed),
                "no-show" => (OpdBooking.Called, OpdBooking.NoShow),
                "requeue" => (OpdBooking.NoShow, OpdBooking.Waiting),
                _ => (null, null)
            };
            if (transition.Item1 is null) return Results.NotFound();
            var actor = ReceptionEndpoints.UserId(user);
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            await OpdBooking.LockQueueAsync(db, ct);
            var day = OpdBooking.Today();
            if (!await Assigned(db, roomId, actor, day, ct)) return Results.Forbid();
            var booking = await db.OpdBookings.SingleOrDefaultAsync(b => b.Id == bookingId && b.OpdDate == day
                && b.RoomId == roomId && b.DoctorId == actor, ct);
            if (booking is null) return Results.NotFound();
            if (booking.Status == transition.Item2) return Results.Ok(PrivateToken(booking));
            if (booking.Status != transition.Item1) return Results.Conflict(new { error = "Invalid consultation transition." });
            booking.Status = transition.Item2!;
            if (action == "start") booking.StartedAt = Now();
            if (action == "complete") booking.CompletedAt = Now();
            if (action == "requeue")
            {
                booking.QueueEnteredAt = Now();
                booking.CalledAt = null;
                booking.RoomId = null;
                booking.DoctorId = null;
            }
            AddEvent(db, booking, actor, action);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            await Publish(db, hub, booking);
            return Results.Ok(PrivateToken(booking));
        });
    }

    internal static async Task<bool> Assigned(MediFlowDbContext db, int roomId, int doctorId, DateOnly day, CancellationToken ct) =>
        await db.Set<OpdAssignment>().AnyAsync(a => a.RoomId == roomId && a.DoctorId == doctorId && a.OpdDate == day && a.Room.Active, ct);

    internal static async Task<PublicQueueToken[]> Snapshot(MediFlowDbContext db, CancellationToken ct)
    {
        var today = OpdBooking.Today();
        return await (from booking in db.OpdBookings.AsNoTracking()
                      join room in db.Set<OpdRoom>() on booking.RoomId equals room.Id
                      where booking.OpdDate == today && (booking.Status == OpdBooking.Called || booking.Status == OpdBooking.InConsultation)
                      orderby booking.TokenNumber
                      select new PublicQueueToken(booking.TokenNumber, room.Name)).ToArrayAsync(ct);
    }

    private static object CallResult(OpdRoomCall call) => new
    {
        empty = call.BookingId is null,
        token = call.BookingId is null ? null : new { id = call.BookingId, call.TokenNumber, call.OpdDate, Status = OpdBooking.Called, call.CalledAt }
    };

    private static object PrivateToken(OpdBooking booking) =>
        new { booking.Id, booking.TokenNumber, booking.OpdDate, booking.Status, booking.CalledAt, booking.StartedAt, booking.CompletedAt };

    private static DateTimeOffset Now()
    {
        var current = DateTimeOffset.UtcNow;
        return current.AddTicks(-(current.Ticks % 10));
    }

    private static void AddEvent(MediFlowDbContext db, OpdBooking booking, int actor, string action) =>
        db.Add(new OpdQueueEvent { BookingId = booking.Id, ActorId = actor, Action = action, At = Now() });

    private static async Task Publish(MediFlowDbContext db, IHubContext<OpdDisplayHub> hub, OpdBooking booking)
    {
        await hub.Clients.Group("public").SendAsync("DisplayUpdated", await Snapshot(db, CancellationToken.None));
        await hub.Clients.Group("staff").SendAsync("QueueUpdated", PrivateToken(booking));
        if (booking.PatientId is int owner)
            await hub.Clients.Group($"patient:{owner}").SendAsync("TokenUpdated", PrivateToken(booking));
    }
}

internal sealed record PublicQueueToken(int TokenNumber, string Room);

internal sealed class OpdDisplayHub : Hub
{
    public override Task OnConnectedAsync() => Groups.AddToGroupAsync(Context.ConnectionId, "public");

    [Authorize(Policy = "AppUser")]
    public async Task Subscribe()
    {
        var user = Context.User!;
        if (user.IsInRole("Patient"))
            await Groups.AddToGroupAsync(Context.ConnectionId, $"patient:{ReceptionEndpoints.UserId(user)}");
        else if (user.IsInRole("OpdStaff") || user.IsInRole("Doctor") || user.IsInRole("Reception"))
            await Groups.AddToGroupAsync(Context.ConnectionId, "staff");
        else
            throw new HubException("This role cannot subscribe to queue changes.");
    }
}
