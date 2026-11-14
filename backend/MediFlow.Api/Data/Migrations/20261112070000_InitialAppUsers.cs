using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

namespace MediFlow.Api.Data.Migrations;

public partial class InitialAppUsers : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "app_users",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                firebase_uid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false)
            },
            constraints: table => table.PrimaryKey("PK_app_users", user => user.id));

        migrationBuilder.CreateIndex(
            name: "IX_app_users_firebase_uid",
            table: "app_users",
            column: "firebase_uid",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "app_users");
    }
}
