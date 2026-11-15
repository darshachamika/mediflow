using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace MediFlow.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class OpdFaqGuides : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "opd_faq_guides",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Text = table.Column<string>(type: "text", nullable: false),
                    Keywords = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_opd_faq_guides", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "opd_faq_guides",
                columns: new[] { "Id", "Keywords", "Text", "Title" },
                values: new object[,]
                {
                    { 1, "arrival check checkin reception qr scan booked", "For this demo, take your booked token number or current check-in code to OPD reception. A booked token joins the waiting queue when reception checks it in.", "OPD arrival and check-in" },
                    { 2, "walk walkin walkins account print printed paper", "For this demo, reception can issue a printed walk-in token for a visitor without an account. Walk-in tokens enter the waiting queue immediately.", "OPD walk-in tokens" },
                    { 3, "display screen called room watch queue", "For this demo, the public queue display shows the token number and room when a room calls the token.", "OPD queue display" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "opd_faq_guides");
        }
    }
}
