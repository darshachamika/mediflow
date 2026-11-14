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
        booking.Property(item => item.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(128);
        booking.Property(item => item.OpdDate).HasColumnName("opd_date");
        booking.Property(item => item.TokenNumber).HasColumnName("token_number");
        booking.Property(item => item.Status).HasColumnName("status").HasMaxLength(16).HasDefaultValue(OpdBooking.Waiting);
        booking.Property(item => item.CalledAt).HasColumnName("called_at").HasPrecision(6);
        booking.HasOne<AppUser>().WithMany().HasForeignKey(item => item.PatientId).OnDelete(DeleteBehavior.Restrict);
        booking.HasIndex(item => new { item.PatientId, item.IdempotencyKey }).IsUnique();
        booking.HasIndex(item => new { item.OpdDate, item.TokenNumber }).IsUnique();

        var call = modelBuilder.Entity<OpdCallAction>();
        call.ToTable("opd_call_actions");
        call.HasKey(action => new { action.StaffId, action.IdempotencyKey });
        call.Property(action => action.StaffId).HasColumnName("staff_id");
        call.Property(action => action.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(128);
        call.Property(action => action.BookingId).HasColumnName("booking_id");
        call.HasOne<AppUser>().WithMany().HasForeignKey(action => action.StaffId).OnDelete(DeleteBehavior.Restrict);
        call.HasOne(action => action.Booking).WithMany().HasForeignKey(action => action.BookingId).OnDelete(DeleteBehavior.Restrict);
        call.HasIndex(action => action.BookingId).IsUnique();
    }
}
