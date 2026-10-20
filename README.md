# github-actions-nextjs

Reusable GitHub Actions workflow for deploying Next.js applications with OpenNext to AWS. Terraform roots live here; reusable infrastructure modules are versioned separately in `on-the-edge-cloud/terraform-aws-nextjs`.

## Caller workflow

```yaml
name: Preview environment

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

jobs:
  preview:
    uses: on-the-edge-cloud/github-actions-nextjs/.github/workflows/nextjs-preview.yml@v1
    with:
      config-path: nextjs-app.yml
      command: ${{ github.event.action == 'closed' && 'destroy' || 'deploy' }}
    secrets: inherit
```

The caller must grant `id-token: write`, `contents: read` and `pull-requests: write`, and provide an `AWS_ROLE_ARN` secret. The AWS role trust policy must allow GitHub OIDC for the caller repository.

## Production deployment

Add this workflow to `.github/workflows/production.yml` in the client repository (also available in [`examples/production-client.yml`](examples/production-client.yml)):

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
    uses: on-the-edge-cloud/github-actions-nextjs/.github/workflows/nextjs-production.yml@v1.4
    with:
      config-path: nextjs-app.yml
      platform-ref: v1.4
    secrets: inherit
```

Publish the workflow and the `v1.4` tag before using this example. Keep the workflow reference and `platform-ref` aligned; `platform-ref` controls the checked-out config action and Terraform roots, not the reusable workflow itself.

Production runs only on pushes to `main` or manual runs selecting `main`. It installs dependencies, runs configured lint/tests/builds, applies Terraform, invalidates CloudFront, and runs the optional smoke test. It has no destroy operation or PR comments. The reusable workflow exposes the deployed URL as `needs.production.outputs.production-url` to downstream caller jobs.

The existing `nextjs-app.yml` is shared with previews: `app` controls builds, and `preview.aws-region`, `preview.deployment-type`, and `preview.terraform-module-version` also select the production region, hosting mode, and module version. No separate `production` config mapping is required. The Terraform module version is independent of the actions workflow version.

Production uses the caller's GitHub environment `production`. Configure its branch restrictions and required reviewers as appropriate, and provide `AWS_ROLE_ARN` as a repository or environment secret. The AWS OIDC trust policy must allow `repo:OWNER/REPO:environment:production`. The role needs access to the configured S3 Terraform backend, its workspace state and lock files, and permissions to manage production resources.

Terraform workspaces are `<workspace-prefix-or-slug>-production` for SSR and `<workspace-prefix-or-slug>-static-production` for static hosting. They are separate from PR workspaces. An empty PR number selects the existing production resource naming and disables `force_destroy`. Keep the application slug, hosting mode, and workspace prefix stable after the first deployment; existing production infrastructure must be imported or migrated before adopting this workflow. Production deployments are serialized per caller repository and are not canceled in progress.

The smoke test receives `PRODUCTION_URL`; `PREVIEW_URL` is also set to the same URL for compatibility with existing commands.

## Application config

See [`examples/nextjs-app.yml`](examples/nextjs-app.yml). The reusable workflow displays build and Terraform operations as named steps; only config parsing is a composite action. It checks out the Terraform module tag declared by `preview.terraform-module-version` and selects `terraform/static` or `terraform/preview` using `preview.deployment-type`.

Each app gets a workspace and AWS resource prefix based on its repository slug and PR number. Set `app.workspace-prefix: ""` only when migrating an app with an existing `pr-N` workspace; otherwise the workspace defaults to `<slug>-pr-N`. Concurrency is isolated by caller repository and PR number.

## Security

The workflow skips fork pull requests. App commands are executed from the PR checkout and therefore only trusted contributors should be allowed to trigger the AWS deployment. The AWS role needs permissions to manage the preview resources and pass narrowly scoped Lambda roles.