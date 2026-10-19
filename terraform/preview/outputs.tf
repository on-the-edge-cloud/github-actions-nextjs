output "preview_url" {
  value = module.nextjs.url
}

output "cloudfront_distribution_id" {
  value = module.nextjs.cloudfront_distribution_id
}

output "s3_bucket_name" {
  value = module.nextjs.s3_bucket_name
}