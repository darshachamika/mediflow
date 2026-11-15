using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ClinicalWorkflows : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "opd_appointment_slots",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DoctorId = table.Column<int>(type: "integer", nullable: false),
                    StartsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Capacity = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_appointment_slots", x => x.Id);
                    table.CheckConstraint("CK_opd_appointment_slots_capacity", "\"Capacity\" > 0");
                    table.ForeignKey(
                        name: "FK_opd_appointment_slots_app_users_DoctorId",
                        column: x => x.DoctorId,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "opd_lab_requests",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BookingId = table.Column<long>(type: "bigint", nullable: false),
                    Test = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Result = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    EnteredBy = table.Column<int>(type: "integer", nullable: true),
                    VerifiedBy = table.Column<int>(type: "integer", nullable: true),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_lab_requests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_opd_lab_requests_app_users_EnteredBy",
                        column: x => x.EnteredBy,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_lab_requests_app_users_VerifiedBy",
                        column: x => x.VerifiedBy,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_lab_requests_opd_bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "opd_bookings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "opd_visit_notes",
                columns: table => new
                {
                    BookingId = table.Column<long>(type: "bigint", nullable: false),
                    Notes = table.Column<string>(type: "character varying(16000)", maxLength: 16000, nullable: false),
                    Summary = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_visit_notes", x => x.BookingId);
                    table.ForeignKey(
                        name: "FK_opd_visit_notes_opd_bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "opd_bookings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "opd_appointments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SlotId = table.Column<long>(type: "bigint", nullable: false),
                    PatientId = table.Column<int>(type: "integer", nullable: false),
                    VisitId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_appointments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_opd_appointments_app_users_PatientId",
                        column: x => x.PatientId,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_appointments_opd_appointment_slots_SlotId",
                        column: x => x.SlotId,
                        principalTable: "opd_appointment_slots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_appointments_opd_bookings_VisitId",
                        column: x => x.VisitId,
                        principalTable: "opd_bookings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_opd_appointment_slots_DoctorId_StartsAt",
                table: "opd_appointment_slots",
                columns: new[] { "DoctorId", "StartsAt" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_opd_appointments_PatientId",
                table: "opd_appointments",
                column: "PatientId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_appointments_SlotId_PatientId",
                table: "opd_appointments",
                columns: new[] { "SlotId", "PatientId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_opd_appointments_VisitId",
                table: "opd_appointments",
                column: "VisitId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_lab_requests_BookingId",
                table: "opd_lab_requests",
                column: "BookingId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_lab_requests_EnteredBy",
                table: "opd_lab_requests",
                column: "EnteredBy");

            migrationBuilder.CreateIndex(
                name: "IX_opd_lab_requests_VerifiedBy",
                table: "opd_lab_requests",
                column: "VerifiedBy");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "opd_appointments");

            migrationBuilder.DropTable(
                name: "opd_lab_requests");

            migrationBuilder.DropTable(
                name: "opd_visit_notes");

            migrationBuilder.DropTable(
                name: "opd_appointment_slots");
        }
    }
}
