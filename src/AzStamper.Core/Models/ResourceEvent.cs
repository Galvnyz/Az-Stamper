namespace AzStamper.Core.Models;

public class ResourceEvent
{
    public string? ResourceId { get; set; }
    public string? Caller { get; set; }
    public string? PrincipalType { get; set; }
    public string? PrincipalId { get; set; }
}
