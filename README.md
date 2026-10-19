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

## Application config

See [`examples/nextjs-app.yml`](examples/nextjs-app.yml). The reusable workflow displays build and Terraform operations as named steps; only config parsing is a composite action. It checks out the Terraform module tag declared by `preview.terraform-module-version` and selects `terraform/static` or `terraform/preview` using `preview.deployment-type`.

Each app gets a workspace and AWS resource prefix based on its repository slug and PR number. Set `app.workspace-prefix: ""` only when migrating an app with an existing `pr-N` workspace; otherwise the workspace defaults to `<slug>-pr-N`. Concurrency is isolated by caller repository and PR number.

## Security

The workflow skips fork pull requests. App commands are executed from the PR checkout and therefore only trusted contributors should be allowed to trigger the AWS deployment. The AWS role needs permissions to manage the preview resources and pass narrowly scoped Lambda roles.