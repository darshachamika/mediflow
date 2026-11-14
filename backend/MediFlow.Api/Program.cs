using FirebaseAdmin;
using Google.Apis.Auth.OAuth2;
using MediFlow.Api.Auth;
using MediFlow.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<MediFlowDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("MediFlow")));

builder.Services.AddSingleton(_ => FirebaseApp.Create(new AppOptions
{
    ProjectId = builder.Configuration["Firebase:ProjectId"],
    Credential = GoogleCredential.GetApplicationDefault()
}));

builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(builder.Configuration["Frontend:Origin"]!)
        .WithMethods("GET")
        .WithHeaders("Authorization")));

builder.Services.AddAuthentication(FirebaseBearerHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, FirebaseBearerHandler>(
        FirebaseBearerHandler.SchemeName, _ => { });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy("AppUser", policy => policy.RequireAuthenticatedUser()
        .RequireClaim(FirebaseBearerHandler.AppUserIdClaim));

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

var api = app.MapGroup("/api").RequireAuthorization("AppUser");

api.MapGet("/me", (ClaimsPrincipal user) => Results.Ok(new
{
    id = int.Parse(user.FindFirstValue(FirebaseBearerHandler.AppUserIdClaim)!),
    firebaseUid = user.FindFirstValue(ClaimTypes.NameIdentifier),
    role = user.FindFirstValue(ClaimTypes.Role)
}));

app.Run();