provider "aws" {
  region = var.aws_region
}

locals {
  is_preview      = var.pr_number != ""
  environment     = local.is_preview ? "pr-${var.pr_number}" : "production"
  resource_prefix = local.is_preview ? "${var.app_slug}-static-pr-${var.pr_number}-" : "${var.app_slug}-static-prod-"
}

module "nextjs" {
  source = "../../../.terraform-modules/modules/nextjs-static"

  environment      = local.environment
  resource_prefix  = local.resource_prefix
  app_directory    = var.app_directory
  deploy_artifacts = var.deploy_artifacts
  force_destroy    = local.is_preview
}