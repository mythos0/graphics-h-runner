# Publishing notes (maintainers)

Publishing is fully automated from GitHub:

- **Tag a release** — push a `vX.Y.Z` tag → [`.github/workflows/release.yml`](../.github/workflows/release.yml)
  runs smoke tests, packages the .vsix, publishes to the VS Code Marketplace and creates a GitHub
  Release with the asset.
- **Bump the version on main** — [`.github/workflows/auto-publish.yml`](../.github/workflows/auto-publish.yml)
  detects the `package.json` version change on every push to `main`, and if it changed: builds,
  publishes to the Marketplace, tags `vX.Y.Z` and creates the GitHub Release automatically.
- Both workflows need one repository secret: **`VSCE_PAT`** — an Azure DevOps PAT with
  *Organization: all accessible organizations* and *Scopes: Marketplace → Manage*
  (create at dev.azure.com → User settings → Personal access tokens).
- Marketplace listing page: <https://marketplace.visualstudio.com/items?itemName=mythos0-labs.graphics-h-runner>
- OpenVSX (optional): `npx ovsx publish --pat $OPEN_VSX_TOKEN`.
