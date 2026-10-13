output "repository_url" {
  description = "Address of the repository, without a tag: <account>.dkr.ecr.<region>.amazonaws.com/<cluster_name>/<service_name>. The service's images are pushed here."
  value       = aws_ecr_repository.service.repository_url
}
