using AzStamper.Core.Models;
using AzStamper.Core.Services;

namespace AzStamper.Core.Tests;

public class ComplianceEvaluatorTests
{
    private readonly ComplianceEvaluator _evaluator = new();

    [Fact]
    public void NoPolicies_ReturnsNoViolations()
    {
        var tags = new Dictionary<string, string> { ["Creator"] = "alice" };
        var result = _evaluator.Evaluate(tags, new List<CompliancePolicy>(), "Microsoft.Compute/virtualMachines");
        Assert.Empty(result);
    }

    [Fact]
    public void DisabledPolicy_IsSkipped()
    {
        var tags = new Dictionary<string, string>();
        var policies = new List<CompliancePolicy>
        {
            new() { Name = "Test", Enabled = false, RequiredTags = new() { new() { Name = "Creator" } } }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Empty(result);
    }

    [Fact]
    public void MissingRequiredTag_ProducesViolation()
    {
        var tags = new Dictionary<string, string> { ["Environment"] = "Dev" };
        var policies = new List<CompliancePolicy>
        {
            new() { Name = "Mandatory", RequiredTags = new() { new() { Name = "Creator" }, new() { Name = "Environment" } } }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Single(result);
        Assert.Equal("Creator", result[0].TagName);
        Assert.Equal("missing", result[0].Reason);
        Assert.Equal("Mandatory", result[0].PolicyName);
    }

    [Fact]
    public void TagPresentWithCorrectValue_Passes()
    {
        var tags = new Dictionary<string, string> { ["Environment"] = "Production" };
        var policies = new List<CompliancePolicy>
        {
            new()
            {
                Name = "Env Check",
                RequiredTags = new() { new() { Name = "Environment", AllowedValues = new() { "Production", "Dev" } } }
            }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Empty(result);
    }

    [Fact]
    public void TagPresentWithWrongValue_ProducesViolation()
    {
        var tags = new Dictionary<string, string> { ["Environment"] = "Staging" };
        var policies = new List<CompliancePolicy>
        {
            new()
            {
                Name = "Env Check",
                RequiredTags = new() { new() { Name = "Environment", AllowedValues = new() { "Production", "Dev" } } }
            }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Single(result);
        Assert.Contains("invalid value", result[0].Reason);
    }

    [Fact]
    public void PatternMatch_Passes()
    {
        var tags = new Dictionary<string, string> { ["CostCenter"] = "CC-1234" };
        var policies = new List<CompliancePolicy>
        {
            new()
            {
                Name = "Cost",
                RequiredTags = new() { new() { Name = "CostCenter", Pattern = @"^CC-\d{4}$" } }
            }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Empty(result);
    }

    [Fact]
    public void PatternMismatch_ProducesViolation()
    {
        var tags = new Dictionary<string, string> { ["CostCenter"] = "INVALID" };
        var policies = new List<CompliancePolicy>
        {
            new()
            {
                Name = "Cost",
                RequiredTags = new() { new() { Name = "CostCenter", Pattern = @"^CC-\d{4}$" } }
            }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Single(result);
        Assert.Contains("pattern mismatch", result[0].Reason);
    }

    [Fact]
    public void ResourceTypeScope_FiltersCorrectly()
    {
        var tags = new Dictionary<string, string>();
        var policies = new List<CompliancePolicy>
        {
            new()
            {
                Name = "VM Only",
                RequiredTags = new() { new() { Name = "Creator" } },
                ResourceTypeScope = new() { "Microsoft.Compute/virtualMachines" }
            }
        };

        // Resource type matches scope — should produce violation
        var result1 = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Single(result1);

        // Resource type outside scope — should skip
        var result2 = _evaluator.Evaluate(tags, policies, "Microsoft.Storage/storageAccounts");
        Assert.Empty(result2);
    }

    [Fact]
    public void NullAllowedValues_AcceptsAnyValue()
    {
        var tags = new Dictionary<string, string> { ["Creator"] = "literally-anything" };
        var policies = new List<CompliancePolicy>
        {
            new()
            {
                Name = "Exists Check",
                RequiredTags = new() { new() { Name = "Creator", AllowedValues = null } }
            }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Empty(result);
    }

    [Fact]
    public void AllowedValues_CaseInsensitive()
    {
        var tags = new Dictionary<string, string> { ["Environment"] = "production" };
        var policies = new List<CompliancePolicy>
        {
            new()
            {
                Name = "Env",
                RequiredTags = new() { new() { Name = "Environment", AllowedValues = new() { "Production" } } }
            }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Empty(result);
    }

    [Fact]
    public void InvalidRegex_DoesNotThrow()
    {
        var tags = new Dictionary<string, string> { ["Tag"] = "value" };
        var policies = new List<CompliancePolicy>
        {
            new()
            {
                Name = "Bad Regex",
                RequiredTags = new() { new() { Name = "Tag", Pattern = "[invalid(" } }
            }
        };
        var result = _evaluator.Evaluate(tags, policies, "Microsoft.Compute/virtualMachines");
        Assert.Empty(result); // Invalid regex is silently skipped
    }
}
