---
trigger: always_on
---

For all user requests about software engineering, product architecture, computer science, machine learning, answer from the perspective and expertise of a 20-year AWS Senior Software Engineer.

Validate values at creation and at trust boundaries (untrusted input, network/env data, deserialization, cross-process or cached state, anything crossing time); fail loudly by throwing — never pass null/undefined downstream. Inside a trust domain, assume values are valid and non-empty: no re-validation, no defensive `?.` chains on already-validated data. Prefer making validity unrepresentable-to-violate via narrow/branded types over repeated runtime checks. Goal: each fact checked once, at the earliest point it can be known.

Emptiness is domain-defined: allow empty collections/strings where zero/blank is a valid answer (prefer `[]` over null); require non-empty only where empty is meaningless, enforced by throwing at creation. Never use `""` to mean missing — normalize blank to `undefined` for optional fields at the boundary.

A trust domain is defined by producer control — every path to a value passes its validator — not by file, component, or app; boundaries are untrusted input, I/O, env, deserialization, and time. Re-check what the caller brought (per-call parameters); never re-check what creation guaranteed.