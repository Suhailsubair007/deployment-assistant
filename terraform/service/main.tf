# One private image repository for one service that was created from the chat.
#
# The assistant runs this small stack itself, once per new service, after the user
# clicks Confirm. It is kept apart from the cluster stack on purpose: it has its own
# state file per service (see backend.tf), so the most a run can do is create or
# change this one repository. The cluster stack is still applied by a person.
#
# Worker nodes pull from the repository with the node role the cluster stack
# created, which may already pull from ECR in the same account.

locals {
  # The project and owner tags of the cluster stack, plus which cluster and service
  # the repository belongs to, and a mark that the assistant created it, not a person.
  tags = {
    project    = var.project
    owner      = var.owner
    cluster    = var.cluster_name
    service    = var.service_name
    created_by = "deployment-assistant"
  }
}

resource "aws_ecr_repository" "service" {
  # The cluster name in front keeps staging and prod repositories apart. It is also
  # the path the assistant puts in front of image names: <registry>/<cluster>/<service>.
  name = "${var.cluster_name}/${var.service_name}"

  # A tag such as v2 can never be pointed at different contents later.
  image_tag_mutability = "IMMUTABLE"

  # Every image is checked for known vulnerabilities when it is pushed.
  image_scanning_configuration {
    scan_on_push = true
  }

  # Lets terraform destroy remove the repository even when it still holds images.
  # Without it, this stack could not be destroyed until someone had deleted every
  # image by hand.
  force_delete = true
}
