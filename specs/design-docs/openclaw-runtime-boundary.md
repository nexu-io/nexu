# OpenClaw Runtime Boundary

## Purpose

Repo-root `openclaw-runtime/` is Nexu's runtime integration boundary around OpenClaw.

It exists to hold the lowest practical, reusable Node-level helpers required to locate, resolve, and invoke the OpenClaw runtime across Nexu's controller, desktop, development, and packaging flows.

It is not the OpenClaw product itself, and it is not a general orchestration layer.

## What this package is

Repo-root `openclaw-runtime/` is a platform-minimal runtime integration area.

It owns the parts of the Nexu/OpenClaw integration that are fundamentally about runtime shape and runtime invocation, such as:

- runtime entry resolution
- runtime layout resolution
- repo-local runtime layout knowledge
- packaged/extracted sidecar layout knowledge
- thin command-resolution helpers for invoking OpenClaw from Node-compatible environments
- small compatibility helpers needed to keep runtime invocation consistent across callsites

Its job is to make OpenClaw runtime usage explicit and reusable, so higher-level systems do not each carry their own copies of runtime layout and invocation logic.

## What this package is not

This package is not:

- a controller business-logic package
- a desktop lifecycle package
- a launchd abstraction layer
- a Windows packaging orchestrator
- a dev supervisor package
- an install/uninstall workflow manager
- a product-facing feature layer

If a piece of code primarily coordinates systems, owns workflow sequencing, or implements application behavior, it does not belong here.

## Ownership

Repo-root `openclaw-runtime/` owns only runtime integration concerns that are generic enough to be reused across controller, desktop, dev tooling, or dist flows without importing higher-level policy.

Examples of owned responsibilities:

- resolve the effective OpenClaw entrypoint
- resolve the repo-local runtime layout
- resolve packaged vs extracted sidecar locations
- provide minimal command specs for launching OpenClaw
- provide layout-level helpers for runtime assets such as entry, package root, bin, or builtin extensions
- provide Node-level helpers that avoid repeated path and invocation assumptions in callers

## Non-ownership

Repo-root `openclaw-runtime/` must not own:

- controller startup or restart policy
- controller process supervision
- desktop boot/shutdown policy
- Electron lifecycle handling
- launchd service management
- Windows/macOS packaging workflow orchestration
- sidecar extraction workflow policy
- install/uninstall user workflow logic
- application state management
- config compilation or sync policy
- multi-service coordination
- UI-driven or product-driven decisions

In short:

> This package may own how to locate and invoke the runtime.
> It must not own when, why, or under which product workflow the runtime should be used.

## Platform-minimal rule

This package must remain platform-minimal.

That means:

- it may include the smallest possible Node-level helpers needed to keep runtime integration compatible across supported environments
- it may handle platform differences only when necessary for low-level compatibility
- it may be platform-compatible
- it must not become platform-aware orchestration

Specifically, it should not encode:

- launchd-specific orchestration
- Windows distribution workflow control
- Electron process lifecycle decisions
- dev CLI lifecycle policy
- install/uninstall platform policy

This rule is important because otherwise the package will become a second orchestration dumping ground instead of a clean runtime boundary.

## Scope test

Use this test when deciding whether code belongs here:

### Likely belongs here

If the code answers one of these questions, it is a good candidate:

- Where is the OpenClaw runtime entry?
- What is the repo-local runtime layout?
- What is the packaged or extracted sidecar layout?
- What is the minimal command shape needed to run OpenClaw?
- What Node-level compatibility shim is required so callers do not duplicate runtime assumptions?

### Likely does not belong here

If the code answers one of these questions, it should stay outside:

- When should OpenClaw be started or stopped?
- Why is the app using OpenClaw in this workflow?
- How should launchd or another service manager behave?
- How should a packaging pipeline be sequenced?
- How should a desktop session recover from failures?
- How should install or uninstall be orchestrated?

## Inclusion criteria for future migrations

Move code into repo-root `openclaw-runtime/` only if all of the following are true:

1. The code is directly about locating, resolving, or invoking the OpenClaw runtime.
2. The code can be expressed as a low-level Node-compatible helper.
3. The code is reusable across more than one caller or removes duplicated runtime assumptions.
4. The code does not require ownership of lifecycle, orchestration, or product behavior.
5. The code remains valid in both local-development and packaged-runtime contexts.

Good candidates include:

- runtime entry resolvers
- layout resolvers
- sidecar path resolvers
- minimal command-spec builders
- runtime asset locators
- thin compatibility adapters around Node-based invocation

## Exclusion criteria for future migrations

Do not move code here if it:

- orchestrates multiple services
- owns process restart policy
- manages launchd or OS service state
- sequences build or distribution workflows
- manages installer or uninstaller behavior
- depends on Electron lifecycle semantics
- owns controller business rules
- owns dev supervisor policy
- owns user-facing workflow behavior

If a function is better described as orchestration than runtime integration, it does not belong here.

## Implications for callers

### Controller

The controller may depend on this package for runtime entry/command/layout helpers.

The controller must still own:

- process lifecycle decisions
- config generation
- sync behavior
- runtime supervision
- controller-specific policy

### Desktop

The desktop app may depend on this package for runtime layout and invocation helpers.

The desktop app must still own:

- Electron lifecycle
- launchd handling
- packaged app boot/shutdown policy
- update/install behavior
- desktop-specific sidecar orchestration

### Dev tooling

Dev scripts may depend on this package for locating repo-local runtime assets or command shapes.

Dev tooling must still own:

- service ordering
- restart semantics
- pid/lock handling
- local supervisor behavior

### Dist / packaging

Distribution code may use this package as the source of truth for runtime layout assumptions.

Distribution code must still own:

- build sequencing
- artifact reuse policy
- installer workflow
- packaging-specific orchestration

## Relationship to upstream OpenClaw platform support

The platform compatibility of OpenClaw itself is a separate concern.

Repo-root `openclaw-runtime/` does not own upstream OpenClaw platform support. It owns only Nexu's Node-level runtime integration seam around OpenClaw.

## Summary

Repo-root `openclaw-runtime/` should stay:

- small
- Node-oriented
- layout-aware
- invocation-aware
- platform-minimal
- free of orchestration policy

Higher-level systems own behavior and workflow.

Repo-root `openclaw-runtime/` owns only the runtime edge.
