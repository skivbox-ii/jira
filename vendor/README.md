# Vendored Dependencies

`marked-16.4.2.umd.js` is the unmodified UMD distribution of Marked 16.4.2,
copied from the locally installed npm package. License: MIT; full text in
`docs/licenses/marked.txt`.

SHA-256: `2e20e86f0a13107ae9bf00675894bbb573716a8e5b4fde612eacaff1e404c128`.

The importer build wraps it in the private AMD module `_ujgESI_marked` using a
local CommonJS export object. It does not replace Jira's global Markdown
configuration or fetch dependencies at runtime.

The report creates an isolated parser instance and overrides HTML, images and
links before output reaches the DOM. Marked alone does not sanitize HTML.
See [Marked extensibility](https://marked.js.org/using_pro) and
[instance configuration](https://marked.js.org/using_advanced).
