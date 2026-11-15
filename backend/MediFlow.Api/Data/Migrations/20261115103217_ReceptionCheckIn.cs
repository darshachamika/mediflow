using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReceptionCheckIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "patient_id",
                table: "opd_bookings",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "check_in_expires_at",
                table: "opd_bookings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "check_in_hash",
                table: "opd_bookings",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "issued_by_id",
                table: "opd_bookings",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "queue_entered_at",
                table: "opd_bookings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE opd_bookings
                SET queue_entered_at = (opd_date::timestamp AT TIME ZONE 'Asia/Colombo')
                    + token_number * interval '1 microsecond'
                WHERE status = 'Waiting';
                """);

            migrationBuilder.CreateTable(
                name: "opd_check_ins",
                columns: table => new
                {
                    BookingId = table.Column<long>(type: "bigint", nullable: false),
                    StaffId = table.Column<int>(type: "integer", nullable: false),
                    Method = table.Column<string>(type: "text", nullable: false),
                    JoinedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_check_ins", x => x.BookingId);
                    table.ForeignKey(
                        name: "FK_opd_check_ins_app_users_StaffId",
                        column: x => x.StaffId,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_check_ins_opd_bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "opd_bookings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_opd_bookings_check_in_hash",
                table: "opd_bookings",
                column: "check_in_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_opd_bookings_issued_by_id_idempotency_key",
                table: "opd_bookings",
                columns: new[] { "issued_by_id", "idempotency_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_opd_check_ins_StaffId",
                table: "opd_check_ins",
                column: "StaffId");

            migrationBuilder.AddForeignKey(
                name: "FK_opd_bookings_app_users_issued_by_id",
                table: "opd_bookings",
                column: "issued_by_id",
                principalTable: "app_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_opd_bookings_app_users_issued_by_id",
                table: "opd_bookings");

            migrationBuilder.DropTable(
                name: "opd_check_ins");

            migrationBuilder.DropIndex(
                name: "IX_opd_bookings_check_in_hash",
                table: "opd_bookings");

            migrationBuilder.DropIndex(
                name: "IX_opd_bookings_issued_by_id_idempotency_key",
                table: "opd_bookings");

            migrationBuilder.DropColumn(
                name: "check_in_expires_at",
                table: "opd_bookings");

            migrationBuilder.DropColumn(
                name: "check_in_hash",
                table: "opd_bookings");

            migrationBuilder.DropColumn(
                name: "issued_by_id",
                table: "opd_bookings");

            migrationBuilder.DropColumn(
                name: "queue_entered_at",
                table: "opd_bookings");

            migrationBuilder.AlterColumn<int>(
                name: "patient_id",
                table: "opd_bookings",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);
        }
    }
}
