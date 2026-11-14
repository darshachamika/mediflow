using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace MediFlow.Api.Data.Migrations;

[DbContext(typeof(MediFlowDbContext))]
[Migration("20261112070000_InitialAppUsers")]
partial class InitialAppUsers
{
    protected override void BuildTargetModel(ModelBuilder modelBuilder)
    {
        modelBuilder
            .HasAnnotation("ProductVersion", "10.0.8")
            .HasAnnotation("Relational:MaxIdentifierLength", 63);

        modelBuilder.UseIdentityByDefaultColumns();

        modelBuilder.Entity("MediFlow.Api.Data.AppUser", entity =>
        {
            entity.Property<int>("Id")
                .ValueGeneratedOnAdd()
                .HasColumnType("integer")
                .HasColumnName("id")
                .UseIdentityByDefaultColumn();

            entity.Property<string>("FirebaseUid")
                .IsRequired()
                .HasMaxLength(128)
                .HasColumnType("character varying(128)")
                .HasColumnName("firebase_uid");

            entity.Property<string>("Role")
                .IsRequired()
                .HasMaxLength(32)
                .HasColumnType("character varying(32)")
                .HasColumnName("role");

            entity.HasKey("Id");
            entity.HasIndex("FirebaseUid").IsUnique();
            entity.ToTable("app_users");
        });
    }
}
