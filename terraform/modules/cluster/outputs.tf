output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "URL of the cluster's Kubernetes API."
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "Certificate that proves the API endpoint is this cluster, base64 encoded."
  value       = module.eks.cluster_certificate_authority_data
}

output "assistant_role_arn" {
  description = "ARN of the IAM role the Deployment Assistant uses."
  value       = aws_iam_role.assistant.arn
}

output "image_registry" {
  description = "Registry path to put in front of image names, without the image itself. Empty when no repository was created."
  value = (
    var.create_sample_app_repository
    ? trimsuffix(aws_ecr_repository.sample_app[0].repository_url, "/sample-app")
    : ""
  )
}
