using System.Text.RegularExpressions;
using AzStamper.Core.Models;

namespace AzStamper.Core.Services;

public class ComplianceEvaluator
{
    public List<ComplianceViolation> Evaluate(
        Dictionary<string, string> currentTags,
        List<CompliancePolicy> policies,
        string resourceType)
    {
        var violations = new List<ComplianceViolation>();

        foreach (var policy in policies)
        {
            if (!policy.Enabled)
                continue;

            // Check resource type scope — empty means all types
            if (policy.ResourceTypeScope.Count > 0)
            {
                var inScope = policy.ResourceTypeScope
                    .Any(s => string.Equals(s, resourceType, StringComparison.OrdinalIgnoreCase));
                if (!inScope)
                    continue;
            }

            foreach (var req in policy.RequiredTags)
            {
                if (!currentTags.TryGetValue(req.Name, out var tagValue))
                {
                    violations.Add(new ComplianceViolation
                    {
                        PolicyName = policy.Name,
                        TagName = req.Name,
                        Reason = "missing"
                    });
                    continue;
                }

                if (req.AllowedValues is { Count: > 0 })
                {
                    var match = req.AllowedValues
                        .Any(v => string.Equals(v, tagValue, StringComparison.OrdinalIgnoreCase));
                    if (!match)
                    {
                        violations.Add(new ComplianceViolation
                        {
                            PolicyName = policy.Name,
                            TagName = req.Name,
                            Reason = $"invalid value: {tagValue}"
                        });
                        continue;
                    }
                }

                if (!string.IsNullOrEmpty(req.Pattern))
                {
                    try
                    {
                        if (!Regex.IsMatch(tagValue, req.Pattern))
                        {
                            violations.Add(new ComplianceViolation
                            {
                                PolicyName = policy.Name,
                                TagName = req.Name,
                                Reason = $"pattern mismatch: {tagValue}"
                            });
                        }
                    }
                    catch (RegexParseException)
                    {
                        // Invalid regex in config — skip this check
                    }
                }
            }
        }

        return violations;
    }
}
