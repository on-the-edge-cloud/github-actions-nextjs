provider "aws" {
  region = var.aws_region
}

locals {
  is_preview      = var.pr_number != ""
  environment     = local.is_preview ? "pr-${var.pr_number}" : "production"
  resource_prefix = local.is_preview ? "${var.app_slug}-pr-${var.pr_number}-" : "${var.app_slug}-prod-"
  resource_name   = trimsuffix(local.resource_prefix, "-")
}

module "nextjs" {
  source = "../../../.terraform-modules/modules/nextjs-ssr"

  name             = local.resource_name
  environment      = local.environment
  resource_prefix  = local.resource_prefix
  app_directory    = var.app_directory
  deploy_artifacts = var.deploy_artifacts
  force_destroy    = local.is_preview
}