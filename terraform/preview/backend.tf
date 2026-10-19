terraform {
  required_version = ">= 1.10"

  backend "s3" {
    bucket       = "on-the-edge-terraform-state"
    key          = "nextjs/terraform.tfstate"
    region       = "eu-north-1"
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.69"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}