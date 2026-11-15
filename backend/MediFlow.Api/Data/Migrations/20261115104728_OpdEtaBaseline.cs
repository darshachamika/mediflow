using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class OpdEtaBaseline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "opd_estimate_samples",
                columns: table => new
                {
                    BookingId = table.Column<long>(type: "bigint", nullable: false),
                    ObservedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    WaitingAhead = table.Column<int>(type: "integer", nullable: false),
                    ServingRooms = table.Column<int>(type: "integer", nullable: false),
                    BusyRooms = table.Column<int>(type: "integer", nullable: false),
                    ConsultationMinutes = table.Column<double>(type: "double precision", nullable: false),
                    UsesFallback = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_estimate_samples", x => x.BookingId);
                    table.ForeignKey(
                        name: "FK_opd_estimate_samples_opd_bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "opd_bookings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "opd_estimate_samples");
        }
    }
}
