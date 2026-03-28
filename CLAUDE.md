# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Az-Stamper is a C# Azure Function (.NET 8 LTS, isolated worker) triggered by Event Grid that automatically stamps Azure resources with configurable metadata tags. It resolves the creator identity (UPN or Service Principal) and applies a configurable tag map with overwrite semantics.

**Architecture**: Event Grid (ResourceWriteSuccess) → ResourceStamperFunction (thin adapter) → StampOrchestrator (resolve caller → check ignore list → stamp tags)

## Build & Test

```bash
dotnet build Az-Stamper.sln
dotnet test Az-Stamper.sln
dotnet format Az-Stamper.sln --verify-no-changes   # lint
az bicep build --file infra/main.bicep              # validate infra
```

### Run Locally

```bash
cd src/AzStamper.Functions
func start
```

Requires Azure Functions Core Tools v4 and .NET 8 SDK.

## Project Structure

- `src/AzStamper.Core/` — Pure business logic (no Azure Functions dependency). Models, services behind interfaces, StampOrchestrator.
- `src/AzStamper.Functions/` — Thin Azure Functions adapter. Event Grid trigger, DI setup, config binding.
- `tests/AzStamper.Core.Tests/` — xUnit + Moq tests against Core interfaces.
- `infra/` — Bicep modules. `main.bicep` (RG-scoped), `main.sub.bicep` (subscription-scoped Event Grid).

## Conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`
- Branch prefixes: `feat/`, `fix/`, `chore/`
- C#: PascalCase types/methods, _camelCase private fields, async/await with CancellationToken, ILogger<T>
- All Azure SDK operations behind interfaces (ITagService, ICallerResolver) for testability
- Error handling: log and return, never throw from business logic
- Bicep: modular, all resources tagged, managed identity for storage
