output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.cluster.cluster_name
}

output "cluster_endpoint" {
  description = "URL of the cluster's Kubernetes API."
  value       = module.cluster.cluster_endpoint
}

output "update_kubeconfig_command" {
  description = "Adds an admin context for this cluster to your kubeconfig."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.cluster.cluster_name}"
}

output "assistant_role_arn" {
  description = "IAM role the Deployment Assistant uses. It can only work inside the namespaces created here."
  value       = module.cluster.assistant_role_arn
}

output "assistant_kubeconfig_command" {
  description = "Adds a context named eks-assistant that uses the assistant's limited role. Run the app with KUBE_CONTEXT=eks-assistant."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.cluster.cluster_name} --role-arn ${module.cluster.assistant_role_arn} --alias eks-assistant"
}

output "image_registry" {
  description = "Value for the app's IMAGE_REGISTRY setting; empty when no repository was created."
  value       = module.cluster.image_registry
}
