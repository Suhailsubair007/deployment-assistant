provider "aws" {
  region = var.region

  # Every AWS resource created through this provider gets these tags.
  default_tags {
    tags = local.tags
  }
}

# Talks to the cluster created by the cluster module, to create namespaces and RBAC.
# Instead of storing a long-lived credential, it asks the AWS CLI for a short-lived
# token each time, signed with the same AWS identity that runs Terraform.
provider "kubernetes" {
  host                   = module.cluster.cluster_endpoint
  cluster_ca_certificate = base64decode(module.cluster.cluster_certificate_authority_data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.cluster.cluster_name, "--region", var.region]
  }
}
