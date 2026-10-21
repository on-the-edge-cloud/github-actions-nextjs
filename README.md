OpenNext is provided by the platform: clients do not need an OpenNext dependency, config, or build script. Its peer compatibility range is Next.js `>=15.5.28 <16 || >=16.4.1`, which does not guarantee that every version is still supported by the Next.js team. To customize OpenNext, install `@opennextjs/aws` in the app and add `open-next.config.ts`; the action uses the client's package and config. Set `app.opennext-build-command` to replace the managed build entirely. Omit it or leave it empty to use the defaults. The managed build proceeds when Next.js reports an unsupported version; set `app.allow-unsupported-next-version: false` to restore OpenNext's support check and fail the build. Upgrade Next.js to a supported release when possible, since unsupported versions may have unpatched security vulnerabilities.
# github-actions-nextjs

Reusable GitHub Actions workflows for deploying Next.js applications to AWS with OpenNext.

## Caller workflow

```yaml
name: Preview environment

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    uses: on-the-edge-cloud/github-actions-nextjs/.github/workflows/nextjs-preview.yml@v1.16
    with:
      aws-region: eu-north-1
      command: ${{ github.event.action == 'closed' && 'destroy' || 'deploy' }}
    secrets: inherit
```

The caller must grant `id-token: write`, `contents: read` and `pull-requests: write`, and provide an `AWS_ROLE_ARN` secret. The AWS role trust policy must allow GitHub OIDC for the caller repository.

## Production deployment

Add this workflow to the client repository:

```yaml
name: Production environment

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  production:
    uses: on-the-edge-cloud/github-actions-nextjs/.github/workflows/nextjs-production.yml@v1.16
    with:
      aws-region: eu-north-1
    secrets: inherit
```

Production runs only on `main` and uses the caller's `production` environment. Provide `AWS_ROLE_ARN` and allow `repo:OWNER/REPO:environment:production` in the AWS OIDC trust policy. The deployed URL is available as `needs.production.outputs.production-url`.

## Application config

Pass `aws-region` directly in each caller workflow when no other settings need customization; this avoids creating a separate config file. Use the [complete example](examples/nextjs-app.yml) with `config-path` for application overrides. When both are provided, the workflow input `aws-region` takes precedence. Only the `app` mapping is supported in config files; the old `preview` section must be removed. The directory defaults to the repository root, the slug to the normalized repository name, and deployment type to `ssr`. Commands and Node.js remain overridable; clients do not configure Terraform versions. The obsolete `workspace-prefix` output has been removed.

The workflows detect npm or Yarn from the application's `package.json` `packageManager` field, falling back to `yarn.lock` for Yarn or npm otherwise. Dependency caching uses the matching `yarn.lock` or `package-lock.json` in the app directory and is disabled if that lockfile is absent. Yarn uses Corepack (included with the default Node.js 22); set `packageManager`, for example `yarn@4.4.1`, to pin its version. Default install commands are `npm ci`, `yarn install --frozen-lockfile` for Yarn Classic, or `yarn install --immutable` for modern Yarn. Lint and application tests run with `npm run lint` / `npm run test` or `yarn run lint` / `yarn run test` only when the corresponding nonempty script exists in the application's `package.json`; otherwise those steps are skipped. Explicit `app.install-command`, `app.lint-command`, and `app.test-command` overrides take precedence, even without matching scripts. Set `app.lint-command` or `app.test-command` to `""` to disable that step. Replace the npm commands from the complete example when using Yarn.

The default slug lowercases the repository name, replaces runs of non-ASCII-alphanumeric characters with a single hyphen, removes leading and trailing hyphens, and truncates to 24 characters without a trailing hyphen. For example, `ontheedge.cloud` becomes `ontheedge-cloud`. An explicit `app.slug` is used unchanged and must contain only lowercase ASCII letters, digits, and single hyphens between segments, with a maximum of 24 characters. Choose an explicit slug if normalized names would collide, and keep it stable for existing deployments because it identifies infrastructure and Terraform state.

The smoke test step runs after CloudFront invalidation. It does nothing by default; set `app.smoke-test-command` to run a custom check, for example `npm run smoke`. The command runs in the app directory with `PREVIEW_URL`, `PRODUCTION_URL`, and `BASE_URL` set to the deployed URL.

OpenNext is provided by the platform: clients do not need an OpenNext dependency, config, or build script. Its peer compatibility range is Next.js `>=15.5.28 <16 || >=16.4.1`, which does not guarantee that every version is still supported by the Next.js team. To customize OpenNext, install `@opennextjs/aws` in the app and add `open-next.config.ts`; the action uses the client's package and config. Set `app.opennext-build-command` to replace the managed build entirely. Omit it or leave it empty to use the defaults. Upgrade Next.js to a supported release when possible; `app.allow-unsupported-next-version: true` explicitly bypasses OpenNext's support check and may deploy a version with unpatched security vulnerabilities.

## Terraform state

State is isolated by repository, hosting mode, and PR or production. The AWS role needs access to the S3 state and lock files. Existing infrastructure requires state migration before deploy or destroy; migration is not automatic. Back up the old state, reconcile resource addresses with the new module, and review the plan before applying.

## Security

The workflow skips fork pull requests. App commands are executed from the PR checkout and therefore only trusted contributors should be allowed to trigger the AWS deployment. The AWS role needs permissions to manage the preview resources and pass narrowly scoped Lambda roles.

## Shared actions

TypeScript actions in `actions/` handle application commands, OpenNext builds, Terraform preparation, backend initialization, deployment outputs, CloudFront invalidation, optional smoke tests, and preview comments.

```bash
npm ci --prefix actions
npm run check --prefix actions
npm test --prefix actions
```

## Releases

Every push to `main` runs the action checks and publishes the next GitHub release and tag: `v1.9`, `v1.10`, and so on, continuing from `v1.8`. The release commit updates workflow references in tracked README files and uses `[skip ci]` to avoid recursion. Rerunning the same push reuses its release. The workflow needs permission to push to `main`; branch protection must allow the release bot. The first automatic release publishes `v1.9` before clients can use the examples above.