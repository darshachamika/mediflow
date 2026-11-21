using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DoctorLiveDisplay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "doctor_id",
                table: "opd_bookings",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "room_id",
                table: "opd_bookings",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "started_at",
                table: "opd_bookings",
                type: "timestamp(6) with time zone",
                precision: 6,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "opd_queue_events",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BookingId = table.Column<long>(type: "bigint", nullable: false),
                    ActorId = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_queue_events", x => x.Id);
                    table.ForeignKey(
                        name: "FK_opd_queue_events_app_users_ActorId",
                        column: x => x.ActorId,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_queue_events_opd_bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "opd_bookings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "opd_rooms",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    DepartmentId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_rooms", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "opd_assignments",
                columns: table => new
                {
                    RoomId = table.Column<int>(type: "integer", nullable: false),
                    OpdDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DoctorId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_assignments", x => new { x.OpdDate, x.RoomId });
                    table.ForeignKey(
                        name: "FK_opd_assignments_app_users_DoctorId",
                        column: x => x.DoctorId,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_assignments_opd_rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "opd_rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "opd_room_calls",
                columns: table => new
                {
                    DoctorId = table.Column<int>(type: "integer", nullable: false),
                    Key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    RoomId = table.Column<int>(type: "integer", nullable: false),
                    BookingId = table.Column<long>(type: "bigint", nullable: true),
                    TokenNumber = table.Column<int>(type: "integer", nullable: true),
                    OpdDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CalledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_room_calls", x => new { x.DoctorId, x.Key });
                    table.ForeignKey(
                        name: "FK_opd_room_calls_app_users_DoctorId",
                        column: x => x.DoctorId,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_room_calls_opd_bookings_BookingId",
                        column: x => x.BookingId,
                        principalTable: "opd_bookings",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_opd_room_calls_opd_rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "opd_rooms",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_opd_bookings_doctor_id",
                table: "opd_bookings",
                column: "doctor_id");

            migrationBuilder.CreateIndex(
                name: "IX_opd_bookings_opd_date_room_id",
                table: "opd_bookings",
                columns: new[] { "opd_date", "room_id" },
                unique: true,
                filter: "room_id IS NOT NULL AND status IN ('Called', 'InConsultation')");

            migrationBuilder.CreateIndex(
                name: "IX_opd_bookings_opd_date_status_queue_entered_at_token_number",
                table: "opd_bookings",
                columns: new[] { "opd_date", "status", "queue_entered_at", "token_number" });

            migrationBuilder.CreateIndex(
                name: "IX_opd_bookings_room_id",
                table: "opd_bookings",
                column: "room_id");

            migrationBuilder.CreateIndex(
                name: "IX_opd_assignments_DoctorId",
                table: "opd_assignments",
                column: "DoctorId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_assignments_OpdDate_DoctorId",
                table: "opd_assignments",
                columns: new[] { "OpdDate", "DoctorId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_opd_assignments_RoomId",
                table: "opd_assignments",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_queue_events_ActorId",
                table: "opd_queue_events",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_queue_events_BookingId",
                table: "opd_queue_events",
                column: "BookingId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_room_calls_BookingId",
                table: "opd_room_calls",
                column: "BookingId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_room_calls_RoomId",
                table: "opd_room_calls",
                column: "RoomId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_rooms_Name",
                table: "opd_rooms",
                column: "Name",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_opd_bookings_app_users_doctor_id",
                table: "opd_bookings",
                column: "doctor_id",
                principalTable: "app_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_opd_bookings_opd_rooms_room_id",
                table: "opd_bookings",
                column: "room_id",
                principalTable: "opd_rooms",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_opd_bookings_app_users_doctor_id",
                table: "opd_bookings");

            migrationBuilder.DropForeignKey(
                name: "FK_opd_bookings_opd_rooms_room_id",
                table: "opd_bookings");

            migrationBuilder.DropTable(
                name: "opd_assignments");

            migrationBuilder.DropTable(
                name: "opd_queue_events");

            migrationBuilder.DropTable(
                name: "opd_room_calls");

            migrationBuilder.DropTable(
                name: "opd_rooms");

            migrationBuilder.DropIndex(
                name: "IX_opd_bookings_doctor_id",
                table: "opd_bookings");

            migrationBuilder.DropIndex(
                name: "IX_opd_bookings_opd_date_room_id",
                table: "opd_bookings");

            migrationBuilder.DropIndex(
                name: "IX_opd_bookings_opd_date_status_queue_entered_at_token_number",
                table: "opd_bookings");

            migrationBuilder.DropIndex(
                name: "IX_opd_bookings_room_id",
                table: "opd_bookings");

            migrationBuilder.DropColumn(
                name: "doctor_id",
                table: "opd_bookings");

            migrationBuilder.DropColumn(
                name: "room_id",
                table: "opd_bookings");

            migrationBuilder.DropColumn(
                name: "started_at",
                table: "opd_bookings");
        }
    }
}
