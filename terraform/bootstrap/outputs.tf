output "state_bucket" {
  description = "Name of the bucket that holds the Terraform state. Pass it to terraform init of the main stack."
  value       = aws_s3_bucket.state.bucket
}

output "region" {
  description = "Region of the state bucket."
  value       = var.region
}
