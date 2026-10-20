# github-actions-nextjs

Reusable GitHub Actions workflow for deploying Next.js applications with OpenNext to AWS. A single Terraform root lives in `terraform/main.tf`; reusable infrastructure modules are versioned separately in `on-the-edge-cloud/terraform-aws-nextjs`.

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
    secrets: inherit
```

Publish the workflow and the `v1.4` tag before using this example. Clients select the reusable workflow version through `uses`; this platform repository manages the internal checkout references for its config action, Terraform root, and infrastructure module. No additional version inputs are required from clients.

Production runs only on pushes to `main` or manual runs selecting `main`. It installs dependencies, runs configured lint/tests/builds, applies Terraform, invalidates CloudFront, and runs the optional smoke test. It has no destroy operation or PR comments. The reusable workflow exposes the deployed URL as `needs.production.outputs.production-url` to downstream caller jobs.

The existing `nextjs-app.yml` is shared with previews: `app` controls builds, and `preview.aws-region` and `preview.deployment-type` also select the production region and hosting mode. No separate `production` config mapping is required. The Terraform module version is managed by this platform repository, not by client configuration.

Production uses the caller's GitHub environment `production`. Configure its branch restrictions and required reviewers as appropriate, and provide `AWS_ROLE_ARN` as a repository or environment secret. The AWS OIDC trust policy must allow `repo:OWNER/REPO:environment:production`. The role needs access to the configured S3 Terraform backend, its state and lock files, and permissions to manage production resources.

Production uses an empty PR number and its own backend key, separate from all previews. Keep the application slug and hosting mode stable after the first deployment. Existing infrastructure and state must be migrated before adopting this workflow; see Terraform state below. Production deployments are serialized per caller repository and are not canceled in progress.

The smoke test receives `PRODUCTION_URL`; `PREVIEW_URL` is also set to the same URL for compatibility with existing commands.

## Application config

See [`examples/nextjs-app.yml`](examples/nextjs-app.yml). The reusable workflow displays build and Terraform operations as named steps; only config parsing is a composite action. Both workflows pin `on-the-edge-cloud/terraform-aws-nextjs` to `v1.4` and use `modules/nextjs-deployment` from that checkout, without depending on a Terraform Registry release. Module upgrades are managed here; clients do not configure the module version. Legacy `preview.terraform-module-version` fields are ignored and can be removed.

Both SSR and static hosting use `terraform/main.tf`, selected by `TF_VAR_deployment_type` (`ssr` or `static`). The workflows also set `TF_VAR_app_slug`, `TF_VAR_aws_region`, and an absolute `TF_VAR_app_directory` from `app.directory`; previews set `TF_VAR_pr_number`, while production leaves it empty. Outside these workflows, the application directory defaults to one level above the Terraform root. Destroy sets `deploy_artifacts=false` so a local build is not required. Concurrency is isolated by caller repository and PR number.

## Terraform state

The S3 backend is configured by each workflow during `terraform init`, not through Terraform variables:

```bash
terraform -chdir="$TERRAFORM_ROOT" init -reconfigure -input=false \
  -backend-config="bucket=on-the-edge-terraform-state" \
  -backend-config="key=nextjs/${GITHUB_REPOSITORY}/${TF_VAR_deployment_type}/${TF_VAR_pr_number:-production}.tfstate" \
  -backend-config="region=eu-north-1" \
  -backend-config="use_lockfile=true"
```

For example, `owner/app` uses `nextjs/owner/app/ssr/42.tfstate` for an SSR preview and `nextjs/owner/app/static/production.tfstate` for static production. The backend region is independent of the application's AWS region. Deploy and destroy use the same key. Terraform uses the default workspace; `app.workspace-prefix` is accepted for backward compatibility but no longer affects state or resource naming. IAM access must cover the new state keys and their `.tflock` objects.

Before running deploy or destroy against existing infrastructure, back up each old workspace state and migrate it from the old `nextjs/terraform.tfstate` backend to the corresponding repository/mode/PR key in the default workspace. Also reconcile resource addresses with the new `nextjs-deployment` module using the module release's migration guidance or explicit state moves/imports. Review the resulting plan before applying. These workflows use `init -reconfigure` and do not migrate state automatically: without migration, deploy can attempt duplicate resources and destroy will not find the old resources. Never reuse a fixed key across repositories, hosting modes, or PRs.

## Security

The workflow skips fork pull requests. App commands are executed from the PR checkout and therefore only trusted contributors should be allowed to trigger the AWS deployment. The AWS role needs permissions to manage the preview resources and pass narrowly scoped Lambda roles.