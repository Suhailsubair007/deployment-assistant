# A private image repository for the sample app.
#
# Worker nodes sit in private subnets and pull images through the NAT gateway. The
# node role created by the EKS module may already pull from ECR in the same account.

resource "aws_ecr_repository" "sample_app" {
  count = var.create_sample_app_repository ? 1 : 0

  # The cluster name in front keeps staging and prod repositories apart.
  name = "${var.cluster_name}/sample-app"

  # A tag such as v2 can never be pointed at different contents later.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  # Lets terraform destroy remove the repository even when it still holds images.
  force_delete = true
}
