# The only provider. There is no Kubernetes provider on purpose (see versions.tf).
provider "aws" {
  region = var.region

  # Every AWS resource created through this provider gets these tags.
  default_tags {
    tags = local.tags
  }
}
