using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api.Data;

public sealed class MediFlowDbContext(DbContextOptions<MediFlowDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> AppUsers => Set<AppUser>();
    public DbSet<OpdBooking> OpdBookings => Set<OpdBooking>();
    public DbSet<OpdCallAction> OpdCallActions => Set<OpdCallAction>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var appUser = modelBuilder.Entity<AppUser>();
        appUser.ToTable("app_users");
        appUser.Property(user => user.Id).HasColumnName("id");
        appUser.Property(user => user.FirebaseUid).HasColumnName("firebase_uid").HasMaxLength(128);
        appUser.Property(user => user.Role).HasColumnName("role").HasMaxLength(32);
        appUser.HasIndex(user => user.FirebaseUid).IsUnique();

        var booking = modelBuilder.Entity<OpdBooking>();
        booking.ToTable("opd_bookings");
        booking.Property(item => item.Id).HasColumnName("id");
        booking.Property(item => item.PatientId).HasColumnName("patient_id");
        booking.Property(item => item.IssuedById).HasColumnName("issued_by_id");
        booking.Property(item => item.QueueEnteredAt).HasColumnName("queue_entered_at");
        booking.Property(item => item.CheckInHash).HasColumnName("check_in_hash").HasMaxLength(64);
        booking.Property(item => item.CheckInExpiresAt).HasColumnName("check_in_expires_at");
        booking.HasIndex(item => item.CheckInHash).IsUnique();
        booking.HasIndex(item => new { item.IssuedById, item.IdempotencyKey }).IsUnique();
        booking.HasOne<AppUser>().WithMany().HasForeignKey(item => item.IssuedById).OnDelete(DeleteBehavior.Restrict);
        booking.Property(item => item.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(128);
        booking.Property(item => item.OpdDate).HasColumnName("opd_date");
        booking.Property(item => item.TokenNumber).HasColumnName("token_number");
        booking.Property(item => item.Status).HasColumnName("status").HasMaxLength(16).HasDefaultValue(OpdBooking.Waiting);
        booking.Property(item => item.CalledAt).HasColumnName("called_at").HasPrecision(6);
        booking.Property(item => item.CompletedAt).HasColumnName("completed_at").HasPrecision(6);
        booking.Property(item => item.StartedAt).HasColumnName("started_at").HasPrecision(6);
        booking.Property(item => item.RoomId).HasColumnName("room_id");
        booking.Property(item => item.DoctorId).HasColumnName("doctor_id");
        booking.HasOne<OpdRoom>().WithMany().HasForeignKey(item => item.RoomId).OnDelete(DeleteBehavior.Restrict);
        booking.HasOne<AppUser>().WithMany().HasForeignKey(item => item.DoctorId).OnDelete(DeleteBehavior.Restrict);
        booking.HasIndex(item => new { item.OpdDate, item.RoomId }).IsUnique()
            .HasFilter("room_id IS NOT NULL AND status IN ('Called', 'InConsultation')");
        booking.HasIndex(item => new { item.OpdDate, item.Status, item.QueueEnteredAt, item.TokenNumber });
        booking.HasOne<AppUser>().WithMany().HasForeignKey(item => item.PatientId).OnDelete(DeleteBehavior.Restrict);
        booking.HasIndex(item => new { item.PatientId, item.IdempotencyKey }).IsUnique();
        booking.HasIndex(item => new { item.OpdDate, item.TokenNumber }).IsUnique();

        var checkIn = modelBuilder.Entity<OpdCheckIn>();
        checkIn.ToTable("opd_check_ins");
        checkIn.HasKey(item => item.BookingId);
        checkIn.HasOne(item => item.Booking).WithOne().HasForeignKey<OpdCheckIn>(item => item.BookingId);
        checkIn.HasOne<AppUser>().WithMany().HasForeignKey(item => item.StaffId).OnDelete(DeleteBehavior.Restrict);

        var call = modelBuilder.Entity<OpdCallAction>();
        call.ToTable("opd_call_actions");
        call.HasKey(action => new { action.StaffId, action.IdempotencyKey });
        call.Property(action => action.StaffId).HasColumnName("staff_id");
        call.Property(action => action.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(128);
        call.Property(action => action.BookingId).HasColumnName("booking_id");
        call.HasOne<AppUser>().WithMany().HasForeignKey(action => action.StaffId).OnDelete(DeleteBehavior.Restrict);
        call.HasOne(action => action.Booking).WithMany().HasForeignKey(action => action.BookingId).OnDelete(DeleteBehavior.Restrict);
        call.HasIndex(action => action.BookingId).IsUnique();

        var room = modelBuilder.Entity<OpdRoom>();
        room.ToTable("opd_rooms");
        room.Property(item => item.Name).HasMaxLength(80);
        room.HasIndex(item => item.Name).IsUnique();
        room.HasOne<OpdDepartment>().WithMany().HasForeignKey(item => item.DepartmentId).OnDelete(DeleteBehavior.Restrict);

        var department = modelBuilder.Entity<OpdDepartment>();
        department.ToTable("opd_departments");
        department.Property(item => item.Name).HasMaxLength(80);
        department.HasIndex(item => item.Name).IsUnique();

        var adminEvent = modelBuilder.Entity<OpdAdminEvent>();
        adminEvent.ToTable("opd_admin_events");
        adminEvent.Property(item => item.Action).HasMaxLength(32);
        adminEvent.Property(item => item.Subject).HasMaxLength(100);
        adminEvent.HasOne<AppUser>().WithMany().HasForeignKey(item => item.ActorId).OnDelete(DeleteBehavior.Restrict);

        var notification = modelBuilder.Entity<OpdNotification>();
        notification.ToTable("opd_notification_outbox");
        notification.Property(item => item.Kind).HasMaxLength(32);
        notification.HasIndex(item => new { item.DueAt, item.Id }).HasFilter("\"DeliveredAt\" IS NULL AND \"FailedAt\" IS NULL");
        notification.HasOne<AppUser>().WithMany().HasForeignKey(item => item.PatientId).OnDelete(DeleteBehavior.Restrict);

        var estimate = modelBuilder.Entity<OpdEstimateSample>();
        estimate.ToTable("opd_estimate_samples");
        estimate.HasKey(item => item.BookingId);
        estimate.HasOne(item => item.Booking).WithOne().HasForeignKey<OpdEstimateSample>(item => item.BookingId).OnDelete(DeleteBehavior.Restrict);

        var faq = modelBuilder.Entity<OpdFaqGuide>();
        faq.ToTable("opd_faq_guides");
        faq.HasData(
            new OpdFaqGuide { Id = 1, Title = "OPD arrival and check-in", Keywords = "arrival check checkin reception qr scan booked",
                Text = "For this demo, take your booked token number or current check-in code to OPD reception. A booked token joins the waiting queue when reception checks it in." },
            new OpdFaqGuide { Id = 2, Title = "OPD walk-in tokens", Keywords = "walk walkin walkins account print printed paper",
                Text = "For this demo, reception can issue a printed walk-in token for a visitor without an account. Walk-in tokens enter the waiting queue immediately." },
            new OpdFaqGuide { Id = 3, Title = "OPD queue display", Keywords = "display screen called room watch queue",
                Text = "For this demo, the public queue display shows the token number and room when a room calls the token." });

        var assignment = modelBuilder.Entity<OpdAssignment>();
        assignment.ToTable("opd_assignments");
        assignment.HasKey(item => new { item.OpdDate, item.RoomId });
        assignment.HasIndex(item => new { item.OpdDate, item.DoctorId }).IsUnique();
        assignment.HasOne(item => item.Room).WithMany().HasForeignKey(item => item.RoomId).OnDelete(DeleteBehavior.Restrict);
        assignment.HasOne<AppUser>().WithMany().HasForeignKey(item => item.DoctorId).OnDelete(DeleteBehavior.Restrict);

        var roomCall = modelBuilder.Entity<OpdRoomCall>();
        roomCall.ToTable("opd_room_calls");
        roomCall.HasKey(item => new { item.DoctorId, item.Key });
        roomCall.Property(item => item.Key).HasMaxLength(128);
        roomCall.HasOne<OpdBooking>().WithMany().HasForeignKey(item => item.BookingId).OnDelete(DeleteBehavior.Restrict);
        roomCall.HasOne<OpdRoom>().WithMany().HasForeignKey(item => item.RoomId).OnDelete(DeleteBehavior.Restrict);
        roomCall.HasOne<AppUser>().WithMany().HasForeignKey(item => item.DoctorId).OnDelete(DeleteBehavior.Restrict);

        var queueEvent = modelBuilder.Entity<OpdQueueEvent>();
        queueEvent.ToTable("opd_queue_events");
        queueEvent.Property(item => item.Action).HasMaxLength(32);
        queueEvent.HasOne<OpdBooking>().WithMany().HasForeignKey(item => item.BookingId).OnDelete(DeleteBehavior.Restrict);
        queueEvent.HasOne<AppUser>().WithMany().HasForeignKey(item => item.ActorId).OnDelete(DeleteBehavior.Restrict);

        var note = modelBuilder.Entity<OpdVisitNote>();
        note.ToTable("opd_visit_notes");
        note.HasKey(item => item.BookingId);
        note.HasOne<OpdBooking>().WithOne().HasForeignKey<OpdVisitNote>(item => item.BookingId).OnDelete(DeleteBehavior.Restrict);
        note.Property(item => item.Notes).HasMaxLength(16000);
        note.Property(item => item.Summary).HasMaxLength(8000);

        var lab = modelBuilder.Entity<OpdLabRequest>();
        lab.ToTable("opd_lab_requests");
        lab.HasOne<OpdBooking>().WithMany().HasForeignKey(item => item.BookingId).OnDelete(DeleteBehavior.Restrict);
        lab.Property(item => item.Test).HasMaxLength(160);
        lab.Property(item => item.Result).HasMaxLength(8000);
        lab.Property(item => item.Status).HasMaxLength(16);
        lab.HasOne<AppUser>().WithMany().HasForeignKey(item => item.EnteredBy).OnDelete(DeleteBehavior.Restrict);
        lab.HasOne<AppUser>().WithMany().HasForeignKey(item => item.VerifiedBy).OnDelete(DeleteBehavior.Restrict);

        var slot = modelBuilder.Entity<OpdAppointmentSlot>();
        slot.ToTable("opd_appointment_slots", table => table.HasCheckConstraint("CK_opd_appointment_slots_capacity", "\"Capacity\" > 0"));
        slot.HasOne<AppUser>().WithMany().HasForeignKey(item => item.DoctorId).OnDelete(DeleteBehavior.Restrict);
        slot.HasIndex(item => new { item.DoctorId, item.StartsAt }).IsUnique();

        var appointment = modelBuilder.Entity<OpdAppointment>();
        appointment.ToTable("opd_appointments");
        appointment.HasOne(item => item.Slot).WithMany().HasForeignKey(item => item.SlotId).OnDelete(DeleteBehavior.Restrict);
        appointment.HasOne<AppUser>().WithMany().HasForeignKey(item => item.PatientId).OnDelete(DeleteBehavior.Restrict);
        appointment.HasOne<OpdBooking>().WithMany().HasForeignKey(item => item.VisitId).OnDelete(DeleteBehavior.Restrict);
        appointment.HasIndex(item => new { item.SlotId, item.PatientId }).IsUnique();
    }
}
