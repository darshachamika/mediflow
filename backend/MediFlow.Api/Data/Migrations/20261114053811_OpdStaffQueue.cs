using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class OpdStaffQueue : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "called_at",
                table: "opd_bookings",
                type: "timestamp(6) with time zone",
                precision: 6,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "status",
                table: "opd_bookings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Waiting");

            migrationBuilder.CreateTable(
                name: "opd_call_actions",
                columns: table => new
                {
                    staff_id = table.Column<int>(type: "integer", nullable: false),
                    idempotency_key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    booking_id = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_call_actions", x => new { x.staff_id, x.idempotency_key });
                    table.ForeignKey(
                        name: "FK_opd_call_actions_app_users_staff_id",
                        column: x => x.staff_id,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_call_actions_opd_bookings_booking_id",
                        column: x => x.booking_id,
                        principalTable: "opd_bookings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_opd_call_actions_booking_id",
                table: "opd_call_actions",
                column: "booking_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "opd_call_actions");

            migrationBuilder.DropColumn(
                name: "called_at",
                table: "opd_bookings");

            migrationBuilder.DropColumn(
                name: "status",
                table: "opd_bookings");
        }
    }
}
