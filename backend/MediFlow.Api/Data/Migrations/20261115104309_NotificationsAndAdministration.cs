using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class NotificationsAndAdministration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "opd_admin_events",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ActorId = table.Column<int>(type: "integer", nullable: false),
                    Action = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Subject = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_admin_events", x => x.Id);
                    table.ForeignKey(
                        name: "FK_opd_admin_events_app_users_ActorId",
                        column: x => x.ActorId,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "opd_departments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_departments", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "opd_notification_outbox",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PatientId = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    TokenNumber = table.Column<int>(type: "integer", nullable: true),
                    AppointmentAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DueAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_notification_outbox", x => x.Id);
                    table.ForeignKey(
                        name: "FK_opd_notification_outbox_app_users_PatientId",
                        column: x => x.PatientId,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_opd_rooms_DepartmentId",
                table: "opd_rooms",
                column: "DepartmentId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_admin_events_ActorId",
                table: "opd_admin_events",
                column: "ActorId");

            migrationBuilder.CreateIndex(
                name: "IX_opd_departments_Name",
                table: "opd_departments",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_opd_notification_outbox_DueAt_Id",
                table: "opd_notification_outbox",
                columns: new[] { "DueAt", "Id" },
                filter: "\"DeliveredAt\" IS NULL AND \"FailedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_opd_notification_outbox_PatientId",
                table: "opd_notification_outbox",
                column: "PatientId");

            migrationBuilder.AddForeignKey(
                name: "FK_opd_rooms_opd_departments_DepartmentId",
                table: "opd_rooms",
                column: "DepartmentId",
                principalTable: "opd_departments",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_opd_rooms_opd_departments_DepartmentId",
                table: "opd_rooms");

            migrationBuilder.DropTable(
                name: "opd_admin_events");

            migrationBuilder.DropTable(
                name: "opd_departments");

            migrationBuilder.DropTable(
                name: "opd_notification_outbox");

            migrationBuilder.DropIndex(
                name: "IX_opd_rooms_DepartmentId",
                table: "opd_rooms");
        }
    }
}
