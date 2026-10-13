# The IAM role the Deployment Assistant uses to reach the cluster.
#
# AWS side:        the role may do exactly one thing, describe this one cluster.
#                  (aws eks update-kubeconfig needs that to find the endpoint.)
# Kubernetes side: the access entry in main.tf maps the role to a group, and the
#                  kubernetes module gives that group a small Role in each namespace.

data "aws_iam_policy_document" "assistant_trust" {
  statement {
    sid     = "AllowNamedPrincipalsToAssume"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = var.assistant_trusted_principal_arns
    }
  }
}

resource "aws_iam_role" "assistant" {
  name               = "${var.cluster_name}-assistant"
  description        = "Used by the Deployment Assistant to reach the ${var.cluster_name} cluster."
  assume_role_policy = data.aws_iam_policy_document.assistant_trust.json
}

data "aws_iam_policy_document" "assistant" {
  statement {
    sid       = "DescribeThisClusterOnly"
    actions   = ["eks:DescribeCluster"]
    resources = [module.eks.cluster_arn]
  }
}

resource "aws_iam_role_policy" "assistant" {
  name   = "describe-cluster"
  role   = aws_iam_role.assistant.id
  policy = data.aws_iam_policy_document.assistant.json
}
