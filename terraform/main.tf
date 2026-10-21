terraform {
  required_version = ">= 1.10"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "app_slug" {
  type = string

  validation {
    condition     = can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", var.app_slug)) && length(var.app_slug) <= 24
    error_message = "app_slug must be lowercase, use single hyphens, and be at most 24 characters."
  }
}

variable "aws_region" {
  type    = string
  default = "eu-north-1"
}

variable "deployment_type" {
  type = string

  validation {
    condition     = contains(["static", "ssr"], var.deployment_type)
    error_message = "deployment_type must be static or ssr."
  }
}

variable "pr_number" {
  type    = string
  default = ""

  validation {
    condition     = var.pr_number == "" || can(regex("^[1-9][0-9]*$", var.pr_number))
    error_message = "pr_number must be empty or a positive integer."
  }
}

variable "app_directory" {
  type    = string
  default = ""
}

variable "domain" {
  description = "Optional production CloudFront hostname. Ignored for previews."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Issued ACM certificate in us-east-1 covering domain. Ignored for previews."
  type        = string
  default     = ""
}

variable "deploy_artifacts" {
  description = "Set false for destroy so Terraform does not require the local build."
  type        = bool
  default     = true
}

locals {
  app_directory = var.app_directory != "" ? abspath(var.app_directory) : abspath("${path.root}/..")
}

module "nextjs" {
  source = "../../.terraform-modules/modules/nextjs-deployment"

  app_slug            = var.app_slug
  app_directory       = local.app_directory
  deployment_type     = var.deployment_type
  pr_number           = var.pr_number
  deploy_artifacts    = var.deploy_artifacts
  domain              = var.pr_number == "" && var.domain != "" ? var.domain : null
  acm_certificate_arn = var.pr_number == "" && var.acm_certificate_arn != "" ? var.acm_certificate_arn : null
}

output "preview_url" {
  value = module.nextjs.preview_url
}

output "cloudfront_distribution_id" {
  value = module.nextjs.cloudfront_distribution_id
}

output "s3_bucket_name" {
  value = module.nextjs.s3_bucket_name
}