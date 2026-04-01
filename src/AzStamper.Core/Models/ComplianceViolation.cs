namespace AzStamper.Core.Models;

public class ComplianceViolation
{
    public string PolicyName { get; set; } = string.Empty;
    public string TagName { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
}
