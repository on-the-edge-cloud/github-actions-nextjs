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
    uses: on-the-edge-cloud/github-actions-nextjs/.github/workflows/nextjs-preview.yml@v1
    with:
      config-path: nextjs-app.yml
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
    uses: on-the-edge-cloud/github-actions-nextjs/.github/workflows/nextjs-production.yml@v1.4
    with:
      config-path: nextjs-app.yml
    secrets: inherit
```

Production runs only on `main` and uses the caller's `production` environment. Provide `AWS_ROLE_ARN` and allow `repo:OWNER/REPO:environment:production` in the AWS OIDC trust policy. The deployed URL is available as `needs.production.outputs.production-url`.

## Application config

Use [`examples/nextjs-app.yml`](examples/nextjs-app.yml) for both previews and production. `app` defines build commands; `preview.aws-region` and `preview.deployment-type` (`ssr` or `static`) apply to both environments. Clients do not configure Terraform versions.

## Terraform state

State is isolated by repository, hosting mode, and PR or production. The AWS role needs access to the S3 state and lock files. Existing infrastructure requires state migration before deploy or destroy; migration is not automatic. Back up the old state, reconcile resource addresses with the new module, and review the plan before applying.

## Security

The workflow skips fork pull requests. App commands are executed from the PR checkout and therefore only trusted contributors should be allowed to trigger the AWS deployment. The AWS role needs permissions to manage the preview resources and pass narrowly scoped Lambda roles.

## Shared actions

TypeScript actions in `actions/` handle application commands, Terraform preparation, backend initialization, deployment outputs, CloudFront invalidation, and preview comments.

```bash
npm ci --prefix actions
npm run check --prefix actions
npm test --prefix actions
```