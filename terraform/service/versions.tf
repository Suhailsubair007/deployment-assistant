terraform {
  # Same range as the cluster stack. 1.11 is the first version where S3 state locking
  # with a lock file is generally available.
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    # Only the AWS provider, pinned like the cluster stack. This stack creates an image
    # repository and never talks to the cluster, so it needs no Kubernetes provider
    # and still works when the cluster's API cannot be reached.
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.68"
    }
  }
}
