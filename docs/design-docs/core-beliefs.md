# Core Beliefs

Nexu engineering/design principles distilled from current project constraints.

1. Zod schema is the single source of truth for API contracts and shared types.
2. Multi-tenant support should reuse OpenClaw native config capabilities before modifying upstream code.
3. Database schema avoids foreign keys; integrity is enforced at the application layer.
4. Secrets and channel credentials must never be logged or exposed in errors.
5. Documentation should separate design intent, product behavior, execution plans, and generated artifacts.
