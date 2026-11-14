using Microsoft.EntityFrameworkCore;

namespace MediFlow.Api.Data;

public sealed class MediFlowDbContext(DbContextOptions<MediFlowDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> AppUsers => Set<AppUser>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var appUser = modelBuilder.Entity<AppUser>();
        appUser.ToTable("app_users");
        appUser.Property(user => user.Id).HasColumnName("id");
        appUser.Property(user => user.FirebaseUid).HasColumnName("firebase_uid").HasMaxLength(128);
        appUser.Property(user => user.Role).HasColumnName("role").HasMaxLength(32);
        appUser.HasIndex(user => user.FirebaseUid).IsUnique();
    }
}
