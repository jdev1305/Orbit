# Orbit v4.4 — clearer example relationships

Copy `src/App.tsx`, `src/App.css`, and `public/examples/example-product.xml` into your existing Orbit project, replacing those files.

- Removed the global **Hide all** button. The remaining eye button restores visibility. Individual object and section visibility controls remain available.
- Example now has **13 fictional objects**: 7 products, 3 GTIN entities, and 3 data containers.
- The **same consumer GTIN** is referenced by the CU, Golden Supplier Item, Supplier Item, Data Pool Item, and Sales Unit. This makes the shared identity visually explicit.
- The case and pallet retain their own GTINs to demonstrate packaging-level identifiers.
- Supplier chain remains CU → Golden Supplier Item → Supplier Item → Data Pool Item, with typed references.
- Both Data Model and Product Explorer derive their graph from the same example STEPXML, with no parser changes.

Run `npm.cmd run lint` and `npm.cmd run build` before committing.
