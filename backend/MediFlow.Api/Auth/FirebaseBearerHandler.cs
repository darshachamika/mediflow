using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using FirebaseAdmin;
using FirebaseAdmin.Auth;
using MediFlow.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MediFlow.Api.Auth;

public sealed partial class FirebaseBearerHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IServiceProvider services,
    MediFlowDbContext db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Bearer";
    public const string AppUserIdClaim = "mediflow_app_user_id";

    [GeneratedRegex(@"\A[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\z")]
    private static partial Regex TokenFormat();

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("Authorization", out var header))
            return AuthenticateResult.NoResult();

        if (header.Count != 1 || !AuthenticationHeaderValue.TryParse(header[0], out var authorization)
            || !SchemeName.Equals(authorization.Scheme, StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(authorization.Parameter)
            || !TokenFormat().IsMatch(authorization.Parameter))
            return AuthenticateResult.Fail("Invalid Bearer header.");

        FirebaseToken token;
        try
        {
            var firebaseAuth = FirebaseAuth.GetAuth(services.GetRequiredService<FirebaseApp>());
            token = await firebaseAuth.VerifyIdTokenAsync(authorization.Parameter, Context.RequestAborted);
        }
        catch (FirebaseAuthException exception) when (exception.AuthErrorCode is
            AuthErrorCode.InvalidIdToken or AuthErrorCode.ExpiredIdToken)
        {
            return AuthenticateResult.Fail("Invalid Firebase ID token.");
        }

        var appUser = await db.AppUsers.AsNoTracking()
            .SingleOrDefaultAsync(user => user.FirebaseUid == token.Uid, Context.RequestAborted);
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, token.Uid) };
        if (appUser is not null)
        {
            claims.Add(new Claim(AppUserIdClaim, appUser.Id.ToString(CultureInfo.InvariantCulture)));
            claims.Add(new Claim(ClaimTypes.Role, appUser.Role));
        }

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.Headers.WWWAuthenticate = SchemeName;
        return base.HandleChallengeAsync(properties);
    }
}
