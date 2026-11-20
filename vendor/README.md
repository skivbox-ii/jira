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

## Importer Excel and diagram libraries

The importer includes these distributions in its public JS and runtime JS.
The checked-in vendor files are unmodified npm package contents; building does
not download anything. Package tarball integrity was verified against npm
metadata before copying them.

| File | npm package | SHA-256 |
| --- | --- | --- |
| `xlsx-0.18.5.full.min.js` | `xlsx@0.18.5` | `c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99` |
| `jszip-3.10.1.min.js` | `jszip@3.10.1` | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |
| `mermaid-11.15.0.min.js` | `mermaid@11.15.0` | `70137e77bb273bb2ef972b86e8b0400cca8be53cb25bfc45911a186dc98665de` |

Licenses: [SheetJS Apache-2.0](../docs/licenses/xlsx-0.18.5.txt),
[JSZip MIT/GPL dual license](../docs/licenses/jszip-3.10.1.txt)
(used under MIT), [Mermaid MIT](../docs/licenses/mermaid-11.15.0.txt).
Bundled third-party notices remain in each distribution.

`build-excel-story-importer.js` wraps each library in a private named AMD
module. UMD libraries see local CommonJS exports, without Jira's AMD
`define` or `require`. The build removes SheetJS's final window assignment
and Mermaid's final global assignment only after verifying their exact
shape. It disables Mermaid's automatic page scan before returning its local
export, so diagrams outside the importer remain untouched. It fails on an unexpected export
shape instead of silently emitting a broken library. No global XLSX, JSZip
or Mermaid is reused or replaced.
