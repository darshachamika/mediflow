using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class OpdTokenCompletion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "completed_at",
                table: "opd_bookings",
                type: "timestamp(6) with time zone",
                precision: 6,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "completed_at",
                table: "opd_bookings");
        }
    }
}
