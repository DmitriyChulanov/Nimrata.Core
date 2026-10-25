namespace Nimrata.Core.Server.Auth;

/// <summary>Роли пользователей платформы</summary>
public static class Roles
{
    /// <summary>Администратор: управляет пользователями</summary>
    public const string Admin = "admin";

    /// <summary>Обычный пользователь</summary>
    public const string Member = "member";

    /// <summary>Допустима ли роль с таким именем</summary>
    public static bool IsKnown(string? role) => role is Admin or Member;
}
