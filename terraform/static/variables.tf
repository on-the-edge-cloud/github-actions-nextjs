variable "app_slug" {
  type = string

  validation {
    condition     = can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", var.app_slug)) && length(var.app_slug) <= 24
    error_message = "app_slug must be lowercase, use single hyphens, and be at most 24 characters."
  }
}

variable "aws_region" {
  type = string
}

variable "app_directory" {
  description = "Absolute path to the application checkout."
  type        = string
}

variable "pr_number" {
  type    = string
  default = ""

  validation {
    condition     = var.pr_number == "" || can(regex("^[1-9][0-9]*$", var.pr_number))
    error_message = "pr_number must be empty or a positive integer."
  }
}

variable "deploy_artifacts" {
  description = "Set false for destroy so Terraform does not require the local build."
  type        = bool
  default     = true
}