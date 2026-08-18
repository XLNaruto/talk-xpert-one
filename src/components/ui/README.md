# components/ui

shadcn/ui primitives. **Generated, not hand-written** — add more with:

```bash
npx shadcn@latest add dialog dropdown-menu popover scroll-area sheet tabs
```

`components.json` is configured for `new-york` + CSS variables, matching the
XpertOne admin app, so a primitive can be copied between the two repos without
edits. Token names are identical in both `globals.css` files; only the values
differ.

Keep app-specific composition out of this folder — that belongs in
`components/common/` (shared) or a feature's `components/` (feature-local).
