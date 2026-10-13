# Creates the S3 bucket that stores the Terraform state of the main stack.
#
# This small stack is applied once, before everything else, and keeps its own state
# in a local file on purpose: a bucket cannot hold the state that describes its own
# creation before it exists. See ../README.md for the reasoning and the alternatives.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project = var.project
      owner   = var.owner
      purpose = "terraform-state"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  # Bucket names are shared by all AWS customers. Adding the account ID and region
  # makes the name unique without anyone typing an account ID into the code.
  bucket_name = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}-${var.region}"
}

resource "aws_s3_bucket" "state" {
  bucket        = local.bucket_name
  force_destroy = var.force_destroy
}

# Keeps every earlier version of the state file, so a bad write can be undone.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# State files can contain sensitive values, so they are encrypted at rest.
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# The bucket can never be made public, even by mistake.
resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
