output "namespaces" {
  description = "Names of the namespaces that were created."
  value       = [for namespace in kubernetes_namespace_v1.environment : namespace.metadata[0].name]
}
