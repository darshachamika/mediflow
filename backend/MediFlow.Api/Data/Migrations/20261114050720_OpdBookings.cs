using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class OpdBookings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "opd_bookings",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    patient_id = table.Column<int>(type: "integer", nullable: false),
                    idempotency_key = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    opd_date = table.Column<DateOnly>(type: "date", nullable: false),
                    token_number = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_bookings", x => x.id);
                    table.ForeignKey(
                        name: "FK_opd_bookings_app_users_patient_id",
                        column: x => x.patient_id,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_opd_bookings_opd_date_token_number",
                table: "opd_bookings",
                columns: new[] { "opd_date", "token_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_opd_bookings_patient_id_idempotency_key",
                table: "opd_bookings",
                columns: new[] { "patient_id", "idempotency_key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "opd_bookings");
        }
    }
}
